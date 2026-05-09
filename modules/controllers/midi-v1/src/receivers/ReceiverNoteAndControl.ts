import { ReceiverBase } from './ReceiverBase';
import { Logger } from '../Logger';
import { AssignmentRecord } from '../GraphReplica';
import { MidiCcEvent, MidiNoteEvent } from '../MidiManager';
import { TargetBase } from '../targets/TargetBase';

interface NoteAndControlParams {
  note: number;
  velocityMin: number;
  velocityMax: number;
  controller: number;
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
  return { note, controller, velocityMin, velocityMax };
}

export class ReceiverNoteAndControl extends ReceiverBase {
  private armedChannel: number | null = null;

  constructor(
    assignment: AssignmentRecord,
    targets: TargetBase[],
    logger: Logger,
    private readonly params: NoteAndControlParams,
  ) {
    super(assignment, targets, logger);
  }

  static build(
    assignment: AssignmentRecord,
    targets: TargetBase[],
    logger: Logger,
  ): ReceiverNoteAndControl | null {
    const params = readParams(assignment.params);
    if (params === null) {
      logger.warn(`assignment ${assignment.guid} missing required note/controller params`);
      return null;
    }
    return new ReceiverNoteAndControl(assignment, targets, logger, params);
  }

  handleNoteOn(e: MidiNoteEvent): void {
    if (!this.channelMatches(e.channel)) return;
    if (e.note !== this.params.note) return;
    if (e.velocity < this.params.velocityMin || e.velocity > this.params.velocityMax) return;
    this.armedChannel = e.channel;
    this.logger.info(`${this.assignment.guid} armed (ch=${e.channel + 1} note=${e.note} v=${e.velocity})`);
  }

  handleNoteOff(e: MidiNoteEvent): void {
    if (e.note !== this.params.note) return;
    if (this.armedChannel === null || e.channel !== this.armedChannel) return;
    this.armedChannel = null;
    this.logger.info(`${this.assignment.guid} disarmed`);
  }

  handleCc(e: MidiCcEvent): void {
    if (this.armedChannel === null) return;
    if (e.channel !== this.armedChannel) return;
    if (e.controller !== this.params.controller) return;
    this.fanOut(e.value / 127);
  }
}
