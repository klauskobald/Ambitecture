// StarterController — minimal headless controller scaffold.
//
// Lifecycle:
//   start() → HubSocket.connect → onConnected → onRegistered → onGraphInit
//   ...graph deltas, runtime updates, hub status, etc. fire as `on*` hooks
//   stop()  → HubSocket.disconnect → onStopping
//
// Subclass and override the `on*` hooks. Use the inherited send helpers
// (sendGraphCommand / sendRuntimeCommand / sendActionTrigger / sendBinding*)
// to talk back to the hub. Do not reimplement transport or graph state.

import { ControllerConfig } from './Config';
import {
  BindingValuePayload,
  GraphCommand,
  GraphDelta,
  HubStatusPayload,
  LockIntentPayload,
  RuntimeCommand,
  RuntimeUpdate,
  WsMessage,
} from './GraphProtocol';
import { HubSocket } from './HubSocket';
import { Logger } from './Logger';
import { ProjectGraph } from './ProjectGraph';

export class StarterController {
  protected readonly graph = new ProjectGraph();
  private readonly socket: HubSocket;

  constructor(
    protected readonly config: ControllerConfig,
    protected readonly logger: Logger,
  ) {
    this.socket = new HubSocket(config, {
      onConnected: () => this.onConnected(),
      onRegistered: () => this.onRegistered(),
      onMessage: message => this.dispatch(message),
      onDisconnected: () => this.onDisconnected(),
      onError: error => this.onError(error),
    }, logger);
  }

  start(): void {
    this.logger.info(`starting "${this.config.name}" (${this.config.guid})`);
    this.socket.connect();
  }

  stop(): void {
    this.socket.disconnect();
    this.onStopping();
  }

  // ─── Send helpers ────────────────────────────────────────────────────────

  protected sendGraphCommand(command: GraphCommand): boolean {
    return this.socket.sendGraphCommand(command);
  }

  protected sendRuntimeCommand(command: RuntimeCommand): boolean {
    return this.socket.sendRuntimeCommand(command);
  }

  protected sendActionTrigger(actionGuid: string, args?: Record<string, unknown>): boolean {
    return this.socket.sendActionTrigger(actionGuid, args);
  }

  protected sendBindingSubscribe(key: string): boolean {
    return this.socket.sendBindingSubscribe(key);
  }

  protected sendBindingSet(key: string, value: unknown): boolean {
    return this.socket.sendBindingSet(key, value);
  }

  protected sendAnimationEdit(animationGuid: string, on: boolean): boolean {
    return this.socket.sendAnimationEdit(animationGuid, on);
  }

  // ─── Lifecycle hooks (override in subclass) ──────────────────────────────

  protected onConnected(): void {
    this.logger.info('connected to hub');
  }

  protected onRegistered(): void {
    this.logger.info('registered as controller; waiting for graph:init');
  }

  protected onGraphInit(): void {
    const sceneName = this.graph.getActiveSceneName() ?? 'none';
    this.logger.info(`graph initialized for "${this.graph.getProjectName()}", active scene "${sceneName}"`);
  }

  protected onGraphDelta(_deltas: GraphDelta[]): void {
    const sceneName = this.graph.getActiveSceneName() ?? 'none';
    this.logger.info(`graph delta applied; active scene "${sceneName}"`);
  }

  protected onRuntimeUpdate(_update: RuntimeUpdate): void {
    // Default: no-op. Subclass to react to relayed live updates from peers.
  }

  protected onSystemCapabilities(_payload: unknown): void {
    this.logger.info('received systemCapabilities');
  }

  protected onHubStatus(payload: HubStatusPayload): void {
    this.logger.info(`hub:status ${payload.kind}`);
  }

  protected onLockIntent(payload: LockIntentPayload): void {
    this.logger.info(`lock:intent guid=${payload.guid} locked=${payload.locked}`);
  }

  protected onBindingValue(payload: BindingValuePayload): void {
    this.logger.info(`binding:value ${payload.key}=${JSON.stringify(payload.value)}`);
  }

  protected onUnknownMessage(message: WsMessage): void {
    this.logger.info(`ignored hub message "${message.type}"`);
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

  // ─── Dispatch ────────────────────────────────────────────────────────────

  private dispatch(message: WsMessage): void {
    switch (message.type) {
      case 'graph:init':
        this.graph.applyGraphInit(message.payload);
        this.onGraphInit();
        break;
      case 'graph:delta': {
        const deltas = Array.isArray(message.payload) ? message.payload : [message.payload];
        this.graph.applyGraphDelta(message.payload);
        this.onGraphDelta(deltas as GraphDelta[]);
        break;
      }
      case 'runtime:update': {
        const update = message.payload as RuntimeUpdate | undefined;
        if (update && update.entityType === 'intent' && typeof update.guid === 'string') {
          this.graph.applyIntentRuntimeOverlay(update.guid, update.patch, update.remove);
        }
        if (update) this.onRuntimeUpdate(update);
        break;
      }
      case 'systemCapabilities':
        this.onSystemCapabilities(message.payload);
        break;
      case 'hub:status':
        this.onHubStatus(message.payload as HubStatusPayload);
        break;
      case 'lock:intent':
        this.onLockIntent(message.payload as LockIntentPayload);
        break;
      case 'binding:value':
        this.onBindingValue(message.payload as BindingValuePayload);
        break;
      default:
        this.onUnknownMessage(message);
        break;
    }
  }
}
