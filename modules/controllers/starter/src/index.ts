// Entry point: load config, instantiate the controller, optionally wire the
// sample runtime loop, and handle graceful shutdown.

import { loadConfig } from './Config';
import { GraphDelta } from './GraphProtocol';
import { Logger } from './Logger';
import { SampleRuntimeLoop } from './sampleRuntimeLoop';
import { StarterController } from './StarterController';

const logger = new Logger('starter-controller');

try {
  const config = loadConfig();

  // Subclass StarterController to wire optional demo behavior into the
  // graph-init / graph-delta lifecycle. Drop the SampleRuntimeLoop part
  // and override more hooks to build your own controller.
  class DemoController extends StarterController {
    private readonly sampleLoop: SampleRuntimeLoop | null;

    constructor() {
      super(config, logger);
      this.sampleLoop = config.sampleIntentGuid
        ? new SampleRuntimeLoop({
            intentGuid: config.sampleIntentGuid,
            intervalMs: config.sampleIntervalMs,
            radius: config.sampleRadius,
            graph: this.graph,
            send: command => this.sendRuntimeCommand(command),
            logger,
          })
        : null;
    }

    protected override onGraphInit(): void {
      super.onGraphInit();
      this.sampleLoop?.start();
    }

    protected override onGraphDelta(deltas: GraphDelta[]): void {
      super.onGraphDelta(deltas);
      // Re-arm the loop on scene changes; start() is a no-op when already running.
      this.sampleLoop?.start();
    }

    override stop(): void {
      this.sampleLoop?.stop();
      super.stop();
    }
  }

  const controller = new DemoController();
  process.on('SIGINT', () => { controller.stop(); process.exit(0); });
  process.on('SIGTERM', () => { controller.stop(); process.exit(0); });
  controller.start();
} catch (error) {
  logger.error('failed to start', error);
  process.exit(1);
}
