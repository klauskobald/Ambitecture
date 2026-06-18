import { ReceiverBase } from './ReceiverBase';
import { Logger } from '../Logger';
import { AssignmentRecord, TargetRecord } from '../GraphReplica';
import { MidiCcEvent, MidiNoteEvent } from '../MidiManager';
import { midiTools } from '../midiTools';
import { TargetBase } from '../targets/TargetBase';

interface NoteAndControlParams {
  note: number;
  velocityMin: number;
  velocityMax: number;
  controller: number;
  controllerAdd: number;
  controllerScale: number;
}

function readParams(raw: Record<string, unknown>): NoteAndControlParams | null {
  const note = raw['note'];
  const controller = raw['controller'];
  const range = raw['velocityRange'];
  if (typeof note !== 'number' || typeof controller !== 'number') return null;
  let velocityMin = 0;
  let velocityMax = 127;
  if (Array.isArray(range) && range.length === 2 && typeof range[0] === 'number' && typeof range[1] === 'number') {
    velocityMin = range[0];
    velocityMax = range[1];
  }
  const controllerAdd = typeof raw['controllerAdd'] === 'number' ? raw['controllerAdd'] : 0;
  const controllerScale = typeof raw['controllerScale'] === 'number' ? raw['controllerScale'] : 1;
  return { note, controller, velocityMin, velocityMax, controllerAdd, controllerScale };
}

function formatIntentTargetsLine(
  targets: TargetRecord[],
  intentName: (guid: string) => string | undefined,
): string[] {
  const bits: string[] = [];
  for (const t of targets) {
    if (t.type !== 'intent') continue;
    const n = intentName(t.guid);
    const label = n !== undefined && n !== '' ? n : '?';
    bits.push(`${label}.${t.key}`);
  }
  return bits;
}

export class ReceiverNoteAndControl extends ReceiverBase {
  private armedChannel: number | null = null;

  constructor(
    assignment: AssignmentRecord,
    targets: TargetBase[],
    logger: Logger,
    private readonly params: NoteAndControlParams,
    onAssignmentActivity?: (input?: number, result?: number) => void,
    private readonly onAssignmentEngaged?: (engaged: boolean) => void,
  ) {
    super(assignment, targets, logger, onAssignmentActivity);
  }

  private signalEngagement(engaged: boolean): void {
    this.onAssignmentEngaged?.(engaged);
  }

  /**
   * Operator-facing one-line description for plugin UI. Built by this class, not generic UI code.
   * @param intentName Resolve intent guid → project display name (undefined if unknown).
   */
  static formatPluginListLine(
    a: AssignmentRecord,
    intentName: (guid: string) => string | undefined,
  ): string | null {
    if (a.class !== 'noteAndControl') return null;
    const params = readParams(a.params);
    if (params === null) return null;
    const chLabel = midiTools.bracketLabel(a);
    const targetBits = formatIntentTargetsLine(
      a.targets,
      guid => {
        const n = intentName(guid);
        // Replace ASCII spaces (U+0020) with hard space (U+00A0)
        return typeof n === 'string' ? n.replace(/ /g, '\u00A0') : n;
      }
    );
    const targetsJoined = targetBits.length > 0 ? targetBits.join(', ') : '—';
    const noteLabel = midiTools.noteAsString(params.note);
    return `[${chLabel}] ${noteLabel} (${params.velocityMin}–${params.velocityMax}) + ctrl ${params.controller} ⮕ ${targetsJoined}`;
  }

  static build(
    assignment: AssignmentRecord,
    targets: TargetBase[],
    logger: Logger,
    onAssignmentActivity?: (input?: number, result?: number) => void,
    onAssignmentEngaged?: (engaged: boolean) => void,
  ): ReceiverNoteAndControl | null {
    const params = readParams(assignment.params);
    if (params === null) {
      logger.warn(`assignment ${assignment.guid} missing required note/controller params`);
      return null;
    }
    return new ReceiverNoteAndControl(
      assignment,
      targets,
      logger,
      params,
      onAssignmentActivity,
      onAssignmentEngaged,
    );
  }

  dispose(): void {
    if (this.armedChannel !== null) {
      this.armedChannel = null;
      this.signalEngagement(false);
    }
  }

  handleNoteOn(e: MidiNoteEvent): void {
    if (!this.deviceMatches(e.device)) return;
    if (!this.channelMatches(e.channel)) return;
    if (e.note !== this.params.note) return;
    if (e.velocity < this.params.velocityMin || e.velocity > this.params.velocityMax) return;
    this.armedChannel = e.channel;
    this.signalEngagement(true);
    this.logger.info(`${this.assignment.guid} armed (ch=${e.channel + 1} note=${e.note} v=${e.velocity})`);
  }

  handleNoteOff(e: MidiNoteEvent): void {
    if (!this.deviceMatches(e.device)) return;
    if (e.note !== this.params.note) return;
    if (this.armedChannel === null || e.channel !== this.armedChannel) return;
    this.armedChannel = null;
    this.signalEngagement(false);
    this.logger.info(`${this.assignment.guid} disarmed`);
  }

  handleCc(e: MidiCcEvent): void {
    if (!this.deviceMatches(e.device)) return;
    if (this.armedChannel === null) return;
    if (e.channel !== this.armedChannel) return;
    if (e.controller !== this.params.controller) return;
    // Pre-curve transform in raw 0..127 CC space: (cc + add) * scale, clamped, then normalized.
    const adjusted = ((e.value + this.params.controllerAdd) * this.params.controllerScale) / 127;
    this.signalAssignmentActivity(e.value, adjusted);
    this.fanOut(adjusted);
  }
}
