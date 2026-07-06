import { TargetBase } from './TargetBase';
import { Logger } from '../Logger';
import { TargetRecord, GraphReplica } from '../GraphReplica';
import { FnCurve } from '../FnCurve';
import { RuntimeCommand } from '../HubSocket';
import { adaptIntentTargetValue } from '../intentValueAdapter';

export type RuntimeCommandSender = (command: RuntimeCommand) => void;

export class TargetIntent extends TargetBase {
  private readonly warnedMissing = new Set<string>();

  constructor(
    target: TargetRecord,
    logger: Logger,
    private readonly graph: GraphReplica,
    private readonly sender: RuntimeCommandSender,
    private readonly getIntentClass: (guid: string) => string | undefined,
    private readonly getSystemCapabilities: () => unknown,
  ) {
    super(target, logger);
  }

  describe(): string {
    return `intent[${this.target.guid}].${this.target.key} (${this.target.function})`;
  }

  send(normalized: number): void {
    if (!this.graph.hasIntent(this.target.guid)) {
      if (!this.warnedMissing.has(this.target.guid)) {
        this.warnedMissing.add(this.target.guid);
        this.logger.warn(`target intent ${this.target.guid} not in graph; dropping further updates`);
      }
      return;
    }
    const curved = FnCurve.evaluate(this.target.function, normalized);
    const intentClass = this.getIntentClass(this.target.guid) ?? '';
    const adapted = adaptIntentTargetValue(
      intentClass,
      this.target.key,
      curved,
      this.getSystemCapabilities(),
    );
    this.sender({
      entityType: 'intent',
      guid: this.target.guid,
      patch: { [this.target.key]: adapted },
    });
  }
}
