import path from 'path';
import { MidiV1Config } from './Config';
import { Logger } from './Logger';
import { MidiManager, MidiCcEvent, MidiNoteEvent } from './MidiManager';
import { HubSocket, RuntimeCommand, WsMessage } from './HubSocket';
import {
  GraphReplica,
  AssignmentsChangedReason,
  AssignmentRecord,
  TargetRecord,
  normalizeAssignmentsInput,
} from './GraphReplica';
import { ReceiverBase } from './receivers/ReceiverBase';
import { ReceiverNoteAndControl } from './receivers/ReceiverNoteAndControl';
import { ReceiverNoteOnOff } from './receivers/ReceiverNoteOnOff';
import { TargetBase } from './targets/TargetBase';
import { TargetIntent } from './targets/TargetIntent';
import { PluginServer } from './PluginServer';
import { summarizeAssignmentForPlugin } from './assignmentSummarize';

export class MidiController {
  private readonly config: MidiV1Config;
  private readonly logger: Logger;
  private readonly graph: GraphReplica;
  private readonly socket: HubSocket;
  private readonly midi: MidiManager;
  private readonly pluginServer: PluginServer;
  private receivers: ReceiverBase[] = [];
  private learn: {
    assignmentGuid: string;
    field: string;
    capture: 'noteOn' | 'controlChange';
  } | null = null;

  constructor(config: MidiV1Config, logger: Logger) {
    this.config = config;
    this.logger = logger;

    this.graph = new GraphReplica(config.guid, logger, reason => this.rebuildReceivers(reason));

    this.socket = new HubSocket(config, {
      onConnected:    () => this.logger.info('connected to hub'),
      onRegistered:   () => this.logger.info(`registered as controller ${config.guid}`),
      onDisconnected: () => this.logger.warn('disconnected from hub; reconnecting'),
      onError:        e  => this.logger.error('socket error', e),
      onMessage:      m  => this.onMessage(m),
    }, logger);

    this.midi = new MidiManager({
      onDeviceConnected:    name => this.logger.info(`midi + ${name}`),
      onDeviceDisconnected: name => this.logger.info(`midi - ${name}`),
      onPortError:          (name, e) => this.logger.warn(`midi ! ${name} open failed: ${e.message}`),
      onNoteOn:        (_n, e) => this.dispatchNoteOn(e),
      onNoteOff:       (_n, e) => this.dispatchNoteOff(e),
      onControlChange: (_n, e) => this.dispatchCc(e),
    });

    this.pluginServer = new PluginServer(config.pluginServer, {
      getAssignments: () => this.graph.getAssignments(),
      getIntentsForPlugin: () => this.graph.listIntentsForPlugin(),
      summarizeForPlugin: a => summarizeAssignmentForPlugin(a, this.graph),
      onSave: arr => this.persistAssignmentsFromUi(arr),
      onLearnStart: (assignmentGuid, field, capture) => {
        let cap: 'noteOn' | 'controlChange';
        if (capture === 'noteOn' || capture === 'controlChange') cap = capture;
        else if (field === 'controller') cap = 'controlChange';
        else cap = 'noteOn';
        this.learn = { assignmentGuid, field, capture: cap };
        this.logger.info(`MIDI learn armed (${field}, ${cap}) for ${assignmentGuid}`);
      },
    }, logger);
  }

  start(): void {
    this.socket.connect();
    this.midi.start();
    this.pluginServer.start(path.join(__dirname, '../ui'));
  }

  stop(): void {
    this.pluginServer.stop();
    this.midi.stop();
    this.socket.disconnect();
    for (const r of this.receivers) r.dispose();
    this.receivers = [];
  }

  private onMessage(message: WsMessage): void {
    this.graph.apply(message);
  }

  private rebuildReceivers(reason: AssignmentsChangedReason): void {
    const assignments = this.graph.getAssignments();
    const prev = this.receivers;
    const next: ReceiverBase[] = [];
    for (const a of assignments) {
      const targets = this.buildTargets(a.targets);
      if (targets.length === 0) {
        this.logger.warn(`assignment ${a.guid} has no usable targets; skipping`);
        continue;
      }
      const receiver = this.buildReceiver(a, targets);
      if (receiver) next.push(receiver);
    }
    for (const r of prev) r.dispose();
    this.receivers = next;
    this.logger.info(`assignments rebuilt (${reason}): ${next.length} receiver(s)`);
    for (const r of next) this.logger.info(`  ${r.describe()}`);
    this.pluginServer.pushState();
  }

  private persistAssignmentsFromUi(raw: unknown[]): void {
    const next = normalizeAssignmentsInput(raw);
    if (next.length !== raw.length) {
      this.logger.warn('save rejected: one or more invalid assignments');
      return;
    }
    const patchList = next.map(a => this.assignmentToPatch(a));
    const sent = this.socket.sendGraphCommand({
      op: 'patch',
      entityType: 'controller',
      guid: this.config.guid,
      patch: { assignments: patchList },
      persistence: 'runtimeAndDurable',
    });
    if (!sent) {
      this.logger.warn('graph:command save dropped (hub socket not open)');
      return;
    }
    this.graph.applyLocalAssignments(next);
    this.pluginServer.pushState();
  }

  private assignmentToPatch(a: AssignmentRecord): Record<string, unknown> {
    return {
      class: a.class,
      guid: a.guid,
      channel: a.channel,
      params: { ...a.params },
      targets: a.targets.map(t => ({ ...t })),
    };
  }

  private buildReceiver(assignment: AssignmentRecord, targets: TargetBase[]): ReceiverBase | null {
    const onActivity = () => this.pluginServer.sendAssignmentTrigger(assignment.guid);
    switch (assignment.class) {
      case 'noteAndControl':
        return ReceiverNoteAndControl.build(assignment, targets, this.logger, onActivity);
      case 'noteOnOff':
        return ReceiverNoteOnOff.build(assignment, targets, this.logger, onActivity);
      default:
        this.logger.warn(`assignment ${assignment.guid}: unknown class "${assignment.class}"`);
        return null;
    }
  }

  private buildTargets(records: TargetRecord[]): TargetBase[] {
    const list: TargetBase[] = [];
    for (const t of records) {
      const target = this.buildTarget(t);
      if (target) list.push(target);
    }
    return list;
  }

  private buildTarget(record: TargetRecord): TargetBase | null {
    switch (record.type) {
      case 'intent':
        return new TargetIntent(record, this.logger, this.graph, c => this.sendRuntime(c));
      default:
        this.logger.warn(`target ${record.guid}: unknown type "${record.type}"`);
        return null;
    }
  }

  private sendRuntime(command: RuntimeCommand): void {
    const sent = this.socket.sendRuntimeCommand(command);
    if (!sent) this.logger.warn(`runtime:command dropped (socket not open) for ${command.entityType} ${command.guid}`);
  }

  private dispatchNoteOn(e: MidiNoteEvent): void {
    const pending = this.learn;
    if (pending !== null && pending.capture === 'noteOn') {
      this.learn = null;
      this.pluginServer.sendLearnResult(pending.assignmentGuid, pending.field, e.note);
      return;
    }
    for (const r of this.receivers) r.handleNoteOn(e);
  }

  private dispatchNoteOff(e: MidiNoteEvent): void {
    for (const r of this.receivers) r.handleNoteOff(e);
  }

  private dispatchCc(e: MidiCcEvent): void {
    const pending = this.learn;
    if (pending !== null && pending.capture === 'controlChange') {
      this.learn = null;
      this.pluginServer.sendLearnResult(pending.assignmentGuid, pending.field, e.controller);
      return;
    }
    for (const r of this.receivers) r.handleCc(e);
  }
}

