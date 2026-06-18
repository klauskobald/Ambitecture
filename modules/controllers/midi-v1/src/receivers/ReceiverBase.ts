import { Logger } from '../Logger';
import { AssignmentRecord } from '../GraphReplica';
import { MidiCcEvent, MidiNoteEvent } from '../MidiManager';
import { TargetBase } from '../targets/TargetBase';

export abstract class ReceiverBase {
  constructor(
    protected readonly assignment: AssignmentRecord,
    protected readonly targets: TargetBase[],
    protected readonly logger: Logger,
    private readonly onAssignmentActivity?: (input?: number, result?: number) => void,
  ) {}

  protected signalAssignmentActivity(input?: number, result?: number): void {
    this.onAssignmentActivity?.(input, result);
  }

  describe(): string {
    const targetDescriptions = this.targets.map(t => t.describe()).join(', ');
    return `${this.assignment.guid} (${this.assignment.class}) → [${targetDescriptions}]`;
  }

  abstract handleNoteOn(e: MidiNoteEvent): void;
  abstract handleNoteOff(e: MidiNoteEvent): void;
  abstract handleCc(e: MidiCcEvent): void;

  // `channelAny` (or channel 0 = nothing learned) matches every channel;
  // otherwise the 1..16 learned channel must equal the 0-indexed event channel.
  protected channelMatches(midiChannel: number): boolean {
    if (this.assignment.channelAny) return true;
    const yamlChannel = this.assignment.channel;
    return yamlChannel === 0 || (yamlChannel - 1) === midiChannel;
  }

  // `deviceAny` (or no learned device) matches every source; otherwise the
  // event must come from the learned port-name key.
  protected deviceMatches(device: string): boolean {
    if (this.assignment.deviceAny) return true;
    if (!this.assignment.device) return true;
    return device === this.assignment.device;
  }

  protected fanOut(normalized: number): void {
    for (const t of this.targets) t.send(normalized);
  }

  dispose(): void {}
}
