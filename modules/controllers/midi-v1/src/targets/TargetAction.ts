import { TargetBase } from './TargetBase';
import { Logger } from '../Logger';
import { TargetRecord, GraphReplica } from '../GraphReplica';

export type ActionTriggerSender = (actionGuid: string) => void;

export class TargetAction extends TargetBase {
  private readonly warnedMissing = new Set<string>();
  /** Rising-edge gate so envelopes / continuous CC do not re-fire every tick. */
  private wasActive = false;

  constructor(
    target: TargetRecord,
    logger: Logger,
    private readonly graph: GraphReplica,
    private readonly sender: ActionTriggerSender,
  ) {
    super(target, logger);
  }

  describe(): string {
    const name = this.graph.getActionName(this.target.guid);
    const label = name !== undefined && name !== '' ? name : this.target.guid;
    return `action[${label}]`;
  }

  send(normalized: number): void {
    const active = normalized > 0;
    if (!active) {
      this.wasActive = false;
      return;
    }
    if (this.wasActive) return;
    this.wasActive = true;
    if (!this.graph.hasAction(this.target.guid)) {
      if (!this.warnedMissing.has(this.target.guid)) {
        this.warnedMissing.add(this.target.guid);
        this.logger.warn(`target action ${this.target.guid} not in graph; dropping further triggers`);
      }
      return;
    }
    this.sender(this.target.guid);
  }
}
