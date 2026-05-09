import { Logger } from '../Logger';
import { AssignmentRecord } from '../GraphReplica';
import { MidiCcEvent, MidiNoteEvent } from '../MidiManager';
import { TargetBase } from '../targets/TargetBase';

export abstract class ReceiverBase {
  constructor(
    protected readonly assignment: AssignmentRecord,
    protected readonly targets: TargetBase[],
    protected readonly logger: Logger,
    private readonly onAssignmentActivity?: () => void,
  ) {}

  protected signalAssignmentActivity(): void {
    this.onAssignmentActivity?.();
  }

  describe(): string {
    const targetDescriptions = this.targets.map(t => t.describe()).join(', ');
    return `${this.assignment.guid} (${this.assignment.class}) → [${targetDescriptions}]`;
  }

  abstract handleNoteOn(e: MidiNoteEvent): void;
  abstract handleNoteOff(e: MidiNoteEvent): void;
  abstract handleCc(e: MidiCcEvent): void;

  // YAML uses 1..16 with 0 meaning "any"; MidiNoteEvent.channel is 0-indexed.
  protected channelMatches(midiChannel: number): boolean {
    const yamlChannel = this.assignment.channel;
    return yamlChannel === 0 || (yamlChannel - 1) === midiChannel;
  }

  protected fanOut(normalized: number): void {
    for (const t of this.targets) t.send(normalized);
  }

  dispose(): void {}
}
