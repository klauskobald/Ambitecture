import { ReceiverBase } from './ReceiverBase';
import { Logger } from '../Logger';
import { AssignmentRecord, TargetRecord } from '../GraphReplica';
import { MidiCcEvent, MidiNoteEvent } from '../MidiManager';
import { midiTools } from '../midiTools';
import { TargetBase } from '../targets/TargetBase';

interface ControlToggleParams {
  controller: number;
  controllerAdd: number;
  controllerScale: number;
}

function readParams(raw: Record<string, unknown>): ControlToggleParams | null {
  const controller = raw['controller'];
  if (typeof controller !== 'number') return null;
  const controllerAdd = typeof raw['controllerAdd'] === 'number' ? raw['controllerAdd'] : 0;
  const controllerScale = typeof raw['controllerScale'] === 'number' ? raw['controllerScale'] : 1;
  return { controller, controllerAdd, controllerScale };
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

export class ReceiverControlToggle extends ReceiverBase {
  private latchedOn = false;

  constructor(
    assignment: AssignmentRecord,
    targets: TargetBase[],
    logger: Logger,
    private readonly params: ControlToggleParams,
    onAssignmentActivity?: (input?: number, result?: number) => void,
    private readonly onAssignmentEngaged?: (engaged: boolean) => void,
  ) {
    super(assignment, targets, logger, onAssignmentActivity);
  }

  private signalEngagement(engaged: boolean): void {
    this.onAssignmentEngaged?.(engaged);
  }

  dispose(): void {
    if (this.latchedOn) {
      this.latchedOn = false;
      this.signalEngagement(false);
    }
  }

  static formatPluginListLine(
    a: AssignmentRecord,
    intentName: (guid: string) => string | undefined,
  ): string | null {
    if (a.class !== 'controlToggle') return null;
    const params = readParams(a.params);
    if (params === null) return null;
    const chLabel = midiTools.bracketLabel(a);
    const targetBits = formatIntentTargetsLine(a.targets, guid => {
      const n = intentName(guid);
      // Replace ASCII spaces (U+0020) with hard space (U+00A0)
      return typeof n === 'string' ? n.replace(/ /g, '\u00A0') : n;
    });
    const targetsJoined = targetBits.length > 0 ? targetBits.join(', ') : '—';
    return `[${chLabel}] ctrl ${params.controller} toggle ⮕ ${targetsJoined}`;
  }

  static build(
    assignment: AssignmentRecord,
    targets: TargetBase[],
    logger: Logger,
    onAssignmentActivity?: (input?: number, result?: number) => void,
    onAssignmentEngaged?: (engaged: boolean) => void,
  ): ReceiverControlToggle | null {
    const params = readParams(assignment.params);
    if (params === null) {
      logger.warn(`assignment ${assignment.guid} missing required controlToggle params`);
      return null;
    }
    return new ReceiverControlToggle(
      assignment,
      targets,
      logger,
      params,
      onAssignmentActivity,
      onAssignmentEngaged,
    );
  }

  handleNoteOn(_e: MidiNoteEvent): void {}

  handleNoteOff(_e: MidiNoteEvent): void {}

  handleCc(e: MidiCcEvent): void {
    if (!this.deviceMatches(e.device)) return;
    if (!this.channelMatches(e.channel)) return;
    if (e.controller !== this.params.controller) return;
    // A 0 value is the button release; only a press (value > 0) flips the latch.
    if (e.value <= 0) return;

    // `add` is a bias that must always reach the output, so the toggled-off
    // value is the bias floor (cc=0), not a hard zero.
    if (this.latchedOn) {
      this.latchedOn = false;
      this.signalEngagement(false);
      const floor = (this.params.controllerAdd * this.params.controllerScale) / 127;
      this.signalAssignmentActivity(e.value, floor);
      this.fanOut(floor);
      return;
    }

    this.latchedOn = true;
    this.signalEngagement(true);
    // Pre-curve transform in raw 0..127 CC space: (cc + add) * scale, normalized.
    const adjusted = ((e.value + this.params.controllerAdd) * this.params.controllerScale) / 127;
    this.signalAssignmentActivity(e.value, adjusted);
    this.fanOut(adjusted);
  }
}
