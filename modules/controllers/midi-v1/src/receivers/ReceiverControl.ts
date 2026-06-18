import { ReceiverBase } from './ReceiverBase';
import { Logger } from '../Logger';
import { AssignmentRecord, TargetRecord } from '../GraphReplica';
import { MidiCcEvent, MidiNoteEvent } from '../MidiManager';
import { midiTools } from '../midiTools';
import { TargetBase } from '../targets/TargetBase';

interface ControlParams {
  controller: number;
  controllerAdd: number;
  controllerScale: number;
}

function readParams(raw: Record<string, unknown>): ControlParams | null {
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

export class ReceiverControl extends ReceiverBase {
  constructor(
    assignment: AssignmentRecord,
    targets: TargetBase[],
    logger: Logger,
    private readonly params: ControlParams,
    onAssignmentActivity?: (input?: number, result?: number) => void,
  ) {
    super(assignment, targets, logger, onAssignmentActivity);
  }

  /**
   * Operator-facing one-line description for plugin UI. Built by this class, not generic UI code.
   * @param intentName Resolve intent guid → project display name (undefined if unknown).
   */
  static formatPluginListLine(
    a: AssignmentRecord,
    intentName: (guid: string) => string | undefined,
  ): string | null {
    if (a.class !== 'control') return null;
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
    return `[${chLabel}] ctrl ${params.controller} ⮕ ${targetsJoined}`;
  }

  static build(
    assignment: AssignmentRecord,
    targets: TargetBase[],
    logger: Logger,
    onAssignmentActivity?: (input?: number, result?: number) => void,
  ): ReceiverControl | null {
    const params = readParams(assignment.params);
    if (params === null) {
      logger.warn(`assignment ${assignment.guid} missing required controller param`);
      return null;
    }
    return new ReceiverControl(assignment, targets, logger, params, onAssignmentActivity);
  }

  handleNoteOn(_e: MidiNoteEvent): void {}

  handleNoteOff(_e: MidiNoteEvent): void {}

  handleCc(e: MidiCcEvent): void {
    if (!this.deviceMatches(e.device)) return;
    if (!this.channelMatches(e.channel)) return;
    if (e.controller !== this.params.controller) return;
    // Pre-curve transform in raw 0..127 CC space: (cc + add) * scale, normalized.
    const adjusted = ((e.value + this.params.controllerAdd) * this.params.controllerScale) / 127;
    this.signalAssignmentActivity(e.value, adjusted);
    this.fanOut(adjusted);
  }
}
