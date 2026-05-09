import { ReceiverBase } from './ReceiverBase';
import { Logger } from '../Logger';
import { AssignmentRecord, TargetRecord } from '../GraphReplica';
import { MidiCcEvent, MidiNoteEvent } from '../MidiManager';
import { midiTools } from '../midiTools';
import { TargetBase } from '../targets/TargetBase';

interface NoteOnOffParams {
  note: number;
  velocityMin: number;
  velocityMax: number;
  velocityOffset: number;
  velocityScale: number;
}

function readParams(raw: Record<string, unknown>): NoteOnOffParams | null {
  const note = raw['note'];
  const range = raw['velocityRange'];
  if (typeof note !== 'number') return null;
  let velocityMin = 0;
  let velocityMax = 127;
  if (Array.isArray(range) && range.length === 2 && typeof range[0] === 'number' && typeof range[1] === 'number') {
    velocityMin = range[0];
    velocityMax = range[1];
  }
  const velocityOffset = typeof raw['velocityOffset'] === 'number' ? raw['velocityOffset'] : 0;
  const velocityScale = typeof raw['velocityScale'] === 'number' ? raw['velocityScale'] : 1;
  return { note, velocityMin, velocityMax, velocityOffset, velocityScale };
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

export class ReceiverNoteOnOff extends ReceiverBase {
  constructor(
    assignment: AssignmentRecord,
    targets: TargetBase[],
    logger: Logger,
    private readonly params: NoteOnOffParams,
  ) {
    super(assignment, targets, logger);
  }

  static formatPluginListLine(
    a: AssignmentRecord,
    intentName: (guid: string) => string | undefined,
  ): string | null {
    if (a.class !== 'noteOnOff') return null;
    const params = readParams(a.params);
    if (params === null) return null;
    const chLabel = a.channel === 0 ? 'any' : String(a.channel);
    const targetBits = formatIntentTargetsLine(a.targets, intentName);
    const targetsJoined = targetBits.length > 0 ? targetBits.join(', ') : '—';
    const noteLabel = midiTools.noteAsString(params.note);
    return `noteOnOff: [${chLabel}] ${noteLabel} (${params.velocityMin}–${params.velocityMax}) +${params.velocityOffset} ×${params.velocityScale} => ${targetsJoined}`;
  }

  static build(assignment: AssignmentRecord, targets: TargetBase[], logger: Logger): ReceiverNoteOnOff | null {
    const params = readParams(assignment.params);
    if (params === null) {
      logger.warn(`assignment ${assignment.guid} missing required noteOnOff params`);
      return null;
    }
    return new ReceiverNoteOnOff(assignment, targets, logger, params);
  }

  handleNoteOn(e: MidiNoteEvent): void {
    if (!this.channelMatches(e.channel)) return;
    if (e.note !== this.params.note) return;
    if (e.velocity < this.params.velocityMin || e.velocity > this.params.velocityMax) return;
    const adjusted = (e.velocity + this.params.velocityOffset) * this.params.velocityScale;
    this.fanOut(adjusted / 127);
  }

  handleNoteOff(e: MidiNoteEvent): void {
    if (!this.channelMatches(e.channel)) return;
    if (e.note !== this.params.note) return;
    this.fanOut(this.params.velocityOffset);
  }

  handleCc(_e: MidiCcEvent): void { }
}
