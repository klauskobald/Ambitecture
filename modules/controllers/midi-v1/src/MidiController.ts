import { MidiV1Config } from './Config';
import { Logger } from './Logger';
import { MidiManager, MidiCcEvent, MidiNoteEvent } from './MidiManager';
import { HubSocket, RuntimeCommand, WsMessage } from './HubSocket';
import { GraphReplica, AssignmentsChangedReason, AssignmentRecord, TargetRecord } from './GraphReplica';
import { ReceiverBase } from './receivers/ReceiverBase';
import { ReceiverNoteAndControl } from './receivers/ReceiverNoteAndControl';
import { TargetBase } from './targets/TargetBase';
import { TargetIntent } from './targets/TargetIntent';

export class MidiController {
  private readonly logger: Logger;
  private readonly graph: GraphReplica;
  private readonly socket: HubSocket;
  private readonly midi: MidiManager;
  private receivers: ReceiverBase[] = [];

  constructor(config: MidiV1Config, logger: Logger) {
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
  }

  start(): void {
    this.socket.connect();
    this.midi.start();
  }

  stop(): void {
    this.midi.stop();
    this.socket.disconnect();
    this.receivers = [];
  }

  private onMessage(message: WsMessage): void {
    this.graph.apply(message);
  }

  private rebuildReceivers(reason: AssignmentsChangedReason): void {
    const assignments = this.graph.getAssignments();
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
    this.receivers = next;
    this.logger.info(`assignments rebuilt (${reason}): ${next.length} receiver(s)`);
    for (const r of next) this.logger.info(`  ${r.describe()}`);
  }

  private buildReceiver(assignment: AssignmentRecord, targets: TargetBase[]): ReceiverBase | null {
    switch (assignment.class) {
      case 'noteAndControl':
        return ReceiverNoteAndControl.build(assignment, targets, this.logger);
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
    for (const r of this.receivers) r.handleNoteOn(e);
  }

  private dispatchNoteOff(e: MidiNoteEvent): void {
    for (const r of this.receivers) r.handleNoteOff(e);
  }

  private dispatchCc(e: MidiCcEvent): void {
    for (const r of this.receivers) r.handleCc(e);
  }
}
