import { Logger } from '../Logger';
import { TargetRecord } from '../GraphReplica';

export abstract class TargetBase {
  constructor(
    protected readonly target: TargetRecord,
    protected readonly logger: Logger,
  ) {}

  abstract describe(): string;
  abstract send(normalized: number): void;
}
