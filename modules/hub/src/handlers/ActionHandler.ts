import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { ActionInputCommand, ActionInputManager } from '../ActionInputManager';
import { GraphMutationResult } from '../GraphProtocol';
import { ProjectGraphStore } from '../ProjectGraphStore';
import { RuntimeUpdate } from '../RuntimeProtocol';
import { RuntimeUpdateDispatcher } from '../RuntimeUpdateDispatcher';
import { ActionExecuteItem } from '../ProjectManager';
import type { AnimationManager } from '../animation/AnimationManager';

type ActionTriggerPayload = {
  actionGuid: string;
  args?: Record<string, unknown>;
};

function isActionInputCommand(payload: unknown): payload is ActionInputCommand {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;
  const input = p['input'];
  const hasValidInput = input !== undefined && typeof input === 'object' && input !== null && !Array.isArray(input);
  switch (p['command']) {
    case 'ensureInputAssignment':
      return typeof p['targetType'] === 'string'
        && p['targetType'].length > 0
        && typeof p['targetGuid'] === 'string'
        && p['targetGuid'].length > 0
        && hasValidInput;
    case 'removeInputAssignment':
      return typeof p['targetType'] === 'string'
        && p['targetType'].length > 0
        && typeof p['targetGuid'] === 'string'
        && p['targetGuid'].length > 0;
    case 'renameInput':
      return typeof p['inputGuid'] === 'string'
        && p['inputGuid'].length > 0
        && typeof p['name'] === 'string';
    default:
      return false;
  }
}

function isActionTriggerPayload(payload: unknown): payload is ActionTriggerPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;
  const args = p['args'];
  const hasValidArgs = args === undefined || (typeof args === 'object' && args !== null && !Array.isArray(args));
  return typeof p['actionGuid'] === 'string' && hasValidArgs;
}

export class ActionHandler implements MessageHandler {
  constructor(
    private registry: ConnectionRegistry,
    private graphStore: ProjectGraphStore,
    private actionInputManager: ActionInputManager,
    private publishMutation: (source: WebSocket, result: GraphMutationResult, location?: [number, number]) => void,
    private runtimeUpdateDispatcher: RuntimeUpdateDispatcher,
    private animationManager?: AnimationManager,
  ) {}

  handle(ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    const info = this.registry.get(ws);
    if (!info || info.role !== 'controller') {
      Logger.warn('[action] ignored — sender is not a controller');
      return;
    }

    switch (message.type) {
      case 'action:input':
        this.handleInputCommand(ws, message, info.guid);
        break;
      case 'action:trigger':
        this.handleTrigger(ws, message, info.guid);
        break;
      default:
        Logger.warn(`[action] unknown message type: ${message.type}`);
        break;
    }
  }

  private handleInputCommand(ws: WebSocket, message: WsMessage, controllerGuid: string): void {
    if (!isActionInputCommand(message.payload)) {
      Logger.warn('[action] invalid action:input payload');
      return;
    }
    const commands = this.actionInputManager.buildCommands(message.payload, controllerGuid);
    for (const command of commands) {
      const result = this.graphStore.applyGraphCommand(command, message.location);
      this.sendResultToSource(ws, result);
      this.publishMutation(ws, result, message.location);
    }
  }

  private handleTrigger(ws: WebSocket, message: WsMessage, sourceGuid: string): void {
    if (!isActionTriggerPayload(message.payload)) {
      Logger.warn('[action] invalid action:trigger payload');
      return;
    }
    const action = this.actionInputManager.getAction(message.payload.actionGuid);
    if (!action) {
      Logger.warn(`[action] action ${message.payload.actionGuid} not found`);
      return;
    }
    const executeItems = this.actionInputManager.getExecuteItemsForAction(action);
    if (executeItems.length === 0) {
      Logger.warn(`[action] action ${message.payload.actionGuid} has no execute targets`);
      return;
    }

    let handled = 0;
    for (const item of executeItems) {
      switch (item.type) {
        case 'scene':
          handled += this.executeSceneItem(ws, item, message);
          break;
        case 'intent':
          handled += this.executeIntentItem(ws, item, sourceGuid, message.payload.args, message.location);
          break;
        case 'animation':
          handled += this.executeAnimationItem(item, message.location, message.payload.args);
          break;
        default:
          Logger.warn(`[action] unsupported execute type "${item.type}" on ${action.guid ?? message.payload.actionGuid}`);
          break;
      }
    }
    if (handled === 0) {
      Logger.warn(`[action] action ${message.payload.actionGuid} has no supported execute targets`);
      return;
    }
    Logger.info(`[action] triggered ${action.guid ?? message.payload.actionGuid} (${handled} execute item(s))`);
  }

  private executeSceneItem(ws: WebSocket, item: ActionExecuteItem, message: WsMessage): number {
    const scene = this.actionInputManager.getSceneForExecuteItem(item);
    if (!scene?.name) {
      Logger.warn(`[action] scene target ${item.guid ?? 'unknown'} not found`);
      return 0;
    }
    const result = this.graphStore.activateScene(scene.name, message.location, 'runtime');
    this.sendResultToSource(ws, result);
    this.publishMutation(ws, result, message.location);
    return 1;
  }

  private executeAnimationItem(
    item: ActionExecuteItem,
    location?: [number, number],
    triggerArgs?: Record<string, unknown>,
  ): number {
    if (item.type !== 'animation' || typeof item.guid !== 'string' || item.guid.length === 0) {
      Logger.warn('[action] invalid animation execute item');
      return 0;
    }
    if (!this.animationManager) {
      Logger.warn('[action] animationManager not configured');
      return 0;
    }

    const opts: { location?: [number, number]; timescale?: number } = {};
    if (location !== undefined) {
      opts.location = location;
    }
    const ts = triggerArgs?.['timescale'];
    if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) {
      opts.timescale = ts;
    }

    this.animationManager.trigger(item.guid, opts);
    return 1;
  }

  private executeIntentItem(
    ws: WebSocket,
    item: ActionExecuteItem,
    sourceGuid: string,
    args: Record<string, unknown> | undefined,
    location?: [number, number]
  ): number {
    const update = this.intentExecuteItemToRuntimeUpdate(item, sourceGuid, args);
    if (!update) return 0;
    this.runtimeUpdateDispatcher.dispatch([update], location, Date.now(), new Set([ws]));
    return 1;
  }

  private intentExecuteItemToRuntimeUpdate(
    item: ActionExecuteItem,
    sourceGuid: string,
    args: Record<string, unknown> | undefined
  ): RuntimeUpdate | null {
    if (item.type !== 'intent' || typeof item.guid !== 'string' || item.guid.length === 0) {
      Logger.warn('[action] invalid intent execute item');
      return null;
    }
    const itemRecord = item as Record<string, unknown>;
    const paramsPatch = this.paramsToRuntimePatch(itemRecord['params']);
    const explicitPatch = this.recordOrUndefined(itemRecord['patch']);
    const patch = {
      ...paramsPatch,
      ...(explicitPatch ?? {}),
      ...(args ?? {}),
    };
    const remove = Array.isArray(itemRecord['remove'])
      ? itemRecord['remove'].filter((entry): entry is string => typeof entry === 'string')
      : undefined;
    const value = this.recordOrUndefined(itemRecord['value']);
    const scheduled = typeof itemRecord['scheduled'] === 'number' ? itemRecord['scheduled'] : undefined;

    return {
      entityType: 'intent',
      guid: item.guid,
      source: sourceGuid,
      ...(Object.keys(patch).length > 0 ? { patch } : {}),
      ...(remove !== undefined ? { remove } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(scheduled !== undefined ? { scheduled } : {}),
    };
  }

  private paramsToRuntimePatch(params: unknown): Record<string, unknown> {
    const record = this.recordOrUndefined(params);
    if (!record) return {};
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      patch[`params.${key}`] = value;
    }
    return patch;
  }

  private recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
  }

  private sendResultToSource(ws: WebSocket, result: GraphMutationResult): void {
    if (result.controllerDeltas.length === 0 || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      message: {
        type: 'graph:delta',
        payload: result.controllerDeltas,
      },
    }));
  }
}
