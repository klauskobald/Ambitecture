import { ControllerConfig } from './Config';
import { Position3, RuntimeCommand, WsMessage } from './GraphProtocol';
import { HubSocket } from './HubSocket';
import { Logger } from './Logger';
import { boundedLoopPosition, MovementBounds, ProjectGraph } from './ProjectGraph';

export class StarterController {
  private readonly graph = new ProjectGraph();
  private readonly socket: HubSocket;
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private sampleBounds: MovementBounds | null = null;
  private sampleStartedAt = 0;
  private lastSampleLogAt = 0;

  constructor(
    private readonly config: ControllerConfig,
    private readonly logger: Logger,
  ) {
    this.socket = new HubSocket(config, {
      onConnected: () => this.onConnected(),
      onRegistered: () => this.onRegistered(),
      onMessage: message => this.handleMessage(message),
      onDisconnected: () => this.onDisconnected(),
      onError: error => this.onError(error),
    }, logger);
  }

  start(): void {
    this.onStarting();
    this.socket.connect();
  }

  stop(): void {
    this.stopSampleLoop();
    this.socket.disconnect();
    this.onStopping();
  }

  protected onStarting(): void {
    this.logger.info(`starting "${this.config.name}" (${this.config.guid})`);
  }

  protected onConnected(): void {
    this.logger.info('connected to hub');
  }

  protected onRegistered(): void {
    this.logger.info('registered as controller; waiting for graph:init');
  }

  protected onGraphInit(): void {
    const activeScene = this.graph.getActiveSceneName() ?? 'none';
    this.logger.info(`graph initialized for "${this.graph.getProjectName()}" with active scene "${activeScene}"`);

    // Start TESTING LOOP
    this.startSampleLoopIfReady();

  }

  protected onGraphDelta(): void {
    const activeScene = this.graph.getActiveSceneName() ?? 'none';
    this.logger.info(`graph delta applied; active scene "${activeScene}"`);

    // Start TESTING LOOP
    this.startSampleLoopIfReady();

  }

  protected onDisconnected(): void {
    this.logger.warn('disconnected from hub; reconnecting');
  }

  protected onError(error: Error): void {
    this.logger.error('socket error', error);
  }

  protected onStopping(): void {
    this.logger.info('stopped');
  }

  private handleMessage(message: WsMessage): void {
    switch (message.type) {
      case 'graph:init':
        this.graph.applyGraphInit(message.payload);
        this.onGraphInit();
        break;
      case 'graph:delta':
        this.graph.applyGraphDelta(message.payload);
        this.onGraphDelta();
        break;
      case 'runtime:update':
        break;
      case 'refresh':
        this.logger.info('received refresh request');
        break;
      case 'systemCapabilities':
        this.logger.info('received system capabilities');
        break;
      default:
        this.logger.info(`ignored hub message "${message.type}"`);
        break;
    }
  }

  /**
   * Start the sample loop if the config is enabled and the loop is not already running.
   */

  private startSampleLoopIfReady(): void {
    if (!this.config.sampleLoop.enabled || this.sampleTimer) {
      return;
    }

    const guid = this.config.sampleLoop.intentGuid;
    const intent = this.graph.getIntent(guid);
    if (!intent) {
      this.logger.warn(`sample loop waiting for intent "${guid}"`);
      return;
    }
    if (!this.graph.isIntentInActiveScene(guid)) {
      const activeScene = this.graph.getActiveSceneName() ?? 'none';
      this.logger.warn(`sample loop idle: intent "${guid}" is not in active scene "${activeScene}"`);
      return;
    }
    this.sampleBounds = this.graph.getMovementBoundsForIntent(guid);
    if (!this.sampleBounds) {
      this.logger.warn(`sample loop waiting for intent "${guid}" to have a position`);
      return;
    }

    this.sampleStartedAt = Date.now();
    this.lastSampleLogAt = 0;
    this.logger.info(`sample loop started for intent "${guid}"`);
    this.sampleTimer = setInterval(() => this.tickSampleLoop(), this.config.sampleLoop.intervalMs);
  }

  private stopSampleLoop(): void {
    if (!this.sampleTimer) {
      return;
    }
    clearInterval(this.sampleTimer);
    this.sampleTimer = null;
    this.sampleBounds = null;
    this.logger.info('sample loop stopped');
  }

  private tickSampleLoop(): void {
    const guid = this.config.sampleLoop.intentGuid;
    if (!this.sampleBounds) {
      this.logger.warn(`sample loop stopped: intent "${guid}" has no position`);
      this.stopSampleLoop();
      return;
    }
    if (!this.graph.isIntentInActiveScene(guid)) {
      this.logger.warn(`sample loop stopped: intent "${guid}" left the active scene`);
      this.stopSampleLoop();
      return;
    }

    const elapsedMs = Date.now() - this.sampleStartedAt;
    const angleRadians = elapsedMs / 1000;
    const position = boundedLoopPosition(this.sampleBounds, this.config.sampleLoop.radius, angleRadians);
    this.sendIntentPosition(guid, position);
  }

  /**
   * Publish sample movement on the generic runtime lane. This keeps the demo loop
   * out of the project graph: no YAML writes, no graph deltas, and no contention
   * with control-plane actions such as scene activation.
   */
  private sendIntentPosition(guid: string, position: Position3): void {
    const command: RuntimeCommand = {
      entityType: 'intent',
      guid,
      patch: { position },
    };
    const sent = this.socket.sendRuntimeCommand(command);
    if (!sent) {
      return;
    }
    this.graph.patchIntentPosition(guid, position);

    const now = Date.now();
    if (now - this.lastSampleLogAt >= 1000) {
      this.lastSampleLogAt = now;
      const formatted = position.map(value => value.toFixed(3)).join(', ');
      this.logger.info(`sample position ${guid}: [${formatted}]`);
    }
  }
}
