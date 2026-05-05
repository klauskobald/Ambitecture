import { ControllerConfig } from './Config';
import { Position3, RuntimeCommand, WsMessage } from './GraphProtocol';
import { HubSocket } from './HubSocket';
import { Logger } from './Logger';
import { boundedLoopPosition, MovementBounds, ProjectGraph } from './ProjectGraph';

export class StarterController {
  private readonly graph = new ProjectGraph();
  private readonly socket: HubSocket;
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private sampleActionTimer: ReturnType<typeof setInterval> | null = null;
  private sampleBounds: MovementBounds | null = null;
  private sampleStartedAt = 0;
  private lastSampleLogAt = 0;
  private nextSampleActionIndex = 0;

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
    this.stopSampleActionLoop();
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
    this.startSampleActionLoopIfReady();

  }

  protected onGraphDelta(): void {
    const activeScene = this.graph.getActiveSceneName() ?? 'none';
    this.logger.info(`graph delta applied; active scene "${activeScene}"`);

    // Start TESTING LOOP
    this.startSampleLoopIfReady();
    this.startSampleActionLoopIfReady();

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

  /**
   * Start a simple alternating action trigger loop. It demonstrates the minimum
   * flow a controller needs: receive graph:init, find action GUIDs in the graph,
   * and trigger them by sending `action:trigger`.
   */
  private startSampleActionLoopIfReady(): void {
    if (this.sampleActionTimer) {
      return;
    }

    const configuredGuids = this.config.sampleActionLoop.actionGuids
      .filter(guid => guid.length > 0);
    if (configuredGuids.length !== 2) {
      this.logger.warn('sample action loop disabled: SAMPLE_ACTION_GUID_1 and SAMPLE_ACTION_GUID_2 are required');
      return;
    }

    for (const guid of configuredGuids) {
      const action = this.graph.getAction(guid);
      if (!action) {
        this.logger.warn(`sample action loop waiting for action "${guid}"`);
        return;
      }
      this.logger.info(`sample action found "${action.name ?? guid}" (${guid})`);
    }

    this.nextSampleActionIndex = 0;
    this.logger.info(`sample action loop started with interval ${this.config.sampleActionLoop.intervalMs}ms`);
    this.sampleActionTimer = setInterval(() => this.tickSampleActionLoop(), this.config.sampleActionLoop.intervalMs);
  }

  private stopSampleActionLoop(): void {
    if (!this.sampleActionTimer) {
      return;
    }
    clearInterval(this.sampleActionTimer);
    this.sampleActionTimer = null;
    this.logger.info('sample action loop stopped');
  }

  private tickSampleActionLoop(): void {
    const guid = this.config.sampleActionLoop.actionGuids[this.nextSampleActionIndex];
    this.nextSampleActionIndex = (this.nextSampleActionIndex + 1) % this.config.sampleActionLoop.actionGuids.length;
    if (!guid) {
      this.logger.warn('sample action loop stopped: missing configured action GUID');
      this.stopSampleActionLoop();
      return;
    }

    const action = this.graph.getAction(guid);
    if (!action) {
      this.logger.warn(`sample action loop stopped: action "${guid}" is no longer available`);
      this.stopSampleActionLoop();
      return;
    }

    const sent = this.socket.sendActionTrigger(guid);
    if (sent) {
      this.logger.info(`sample action trigger "${action.name ?? guid}" (${guid})`);
    }
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
