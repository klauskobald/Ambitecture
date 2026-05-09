// Optional demo: drives a single intent's position in a small circle via
// `runtime:command`. Wired in from index.ts when SAMPLE_INTENT_GUID is set.
// Read this to see the minimal pattern for a custom controller loop.

import { Position3, RuntimeCommand } from './GraphProtocol';
import { Logger } from './Logger';
import { ProjectGraph } from './ProjectGraph';

export interface SampleLoopOptions {
  intentGuid: string;
  intervalMs: number;
  radius: number;
  graph: ProjectGraph;
  send: (command: RuntimeCommand) => boolean;
  logger: Logger;
}

export class SampleRuntimeLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private center: Position3 | null = null;
  private lastLogAt = 0;

  constructor(private readonly opts: SampleLoopOptions) {}

  /** Safe to call repeatedly: starts only when the target intent is in the active scene. */
  start(): void {
    if (this.timer) return;

    const intent = this.opts.graph.getIntent(this.opts.intentGuid);
    if (!intent || !intent.position) {
      this.opts.logger.warn(`sample loop waiting for intent "${this.opts.intentGuid}" with a position`);
      return;
    }
    if (!this.opts.graph.isIntentInActiveScene(this.opts.intentGuid)) {
      this.opts.logger.warn(`sample loop idle: intent "${this.opts.intentGuid}" is not in the active scene`);
      return;
    }

    this.center = intent.position;
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.tick(), this.opts.intervalMs);
    this.opts.logger.info(`sample loop started for intent "${this.opts.intentGuid}"`);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.center = null;
    this.opts.logger.info('sample loop stopped');
  }

  private tick(): void {
    if (!this.center) return;
    if (!this.opts.graph.isIntentInActiveScene(this.opts.intentGuid)) {
      this.opts.logger.warn(`sample loop stopped: intent left the active scene`);
      this.stop();
      return;
    }

    const angle = (Date.now() - this.startedAt) / 1000;
    const position: Position3 = [
      this.center[0] + Math.cos(angle) * this.opts.radius,
      this.center[1],
      this.center[2] + Math.sin(angle) * this.opts.radius,
    ];

    const sent = this.opts.send({
      entityType: 'intent',
      guid: this.opts.intentGuid,
      patch: { position },
    });
    if (!sent) return;

    const now = Date.now();
    if (now - this.lastLogAt >= 1000) {
      this.lastLogAt = now;
      this.opts.logger.info(`sample position [${position.map(v => v.toFixed(3)).join(', ')}]`);
    }
  }
}
