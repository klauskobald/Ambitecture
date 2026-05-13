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
import {
  executeParamsFromItem,
  isActiveTriggerValue,
  resolveIntentOrAnimationBranches,
  shallowMergeActionParams,
} from './actionExecute/resolveActionTrigger';

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
    case 'updateInput':
      return typeof p['inputGuid'] === 'string'
        && p['inputGuid'].length > 0
        && hasValidInput;
    case 'updateAction':
      return typeof p['actionGuid'] === 'string'
        && p['actionGuid'].length > 0
        && typeof p['patch'] === 'object'
        && p['patch'] !== null
        && !Array.isArray(p['patch']);
    case 'assignExistingInput':
      return typeof p['targetType'] === 'string'
        && p['targetType'].length > 0
        && typeof p['targetGuid'] === 'string'
        && p['targetGuid'].length > 0
        && typeof p['inputGuid'] === 'string'
        && p['inputGuid'].length > 0;
    case 'deleteInput': {
      const count = p['expectedLinkedTargetCount'];
      const validCount =
        count === undefined
        || (typeof count === 'number' && Number.isFinite(count) && count >= 0);
      return typeof p['inputGuid'] === 'string'
        && p['inputGuid'].length > 0
        && validCount;
    }
    case 'setInputKeyChar': {
      const k = p['keyChar'];
      const keyOk =
        k === null
        || k === undefined
        || typeof k === 'string';
      return typeof p['inputGuid'] === 'string'
        && p['inputGuid'].length > 0
        && keyOk;
    }
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

/** `action:trigger` → animation: flat `command` from merge resolver — default {@code start}; {@code run} maps to start. */
function normalizedAnimationTriggerCommand(triggerArgs?: Record<string, unknown>): string {
  const raw = triggerArgs?.['command'];
  if (typeof raw !== 'string') {
    return 'start';
  }
  const t = raw.trim().toLowerCase();
  if (t === 'run') {
    return 'start';
  }
  return t.length > 0 ? t : 'start';
}

export class ActionHandler implements MessageHandler {
  constructor(
    private registry: ConnectionRegistry,
    private graphStore: ProjectGraphStore,
    private actionInputManager: ActionInputManager,
    private publishMutation: (source: WebSocket, result: GraphMutationResult, location?: [number, number]) => void,
    private runtimeUpdateDispatcher: RuntimeUpdateDispatcher,
    private animationManager?: AnimationManager,
  ) { }

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
    const executeItem = this.actionInputManager.getExecuteItemForAction(action);
    if (!executeItem) {
      Logger.warn(`[action] action ${message.payload.actionGuid} has no execute target`);
      return;
    }

    let handled = 0;
    const item = executeItem;
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
    if (handled === 0) {
      Logger.warn(`[action] action ${message.payload.actionGuid} has no supported execute target`);
      return;
    }
    Logger.info(`[action] triggered ${action.guid ?? message.payload.actionGuid}`);
  }

  private executeSceneItem(ws: WebSocket, item: ActionExecuteItem, message: WsMessage): number {
    const scene = this.actionInputManager.getSceneForExecuteItem(item);
    if (!scene?.guid) {
      Logger.warn(`[action] scene target ${item.guid ?? 'unknown'} not found`);
      return 0;
    }
    const p = message.payload as Record<string, unknown> | undefined;
    const triggerArgs =
      p && typeof p['args'] === 'object' && p['args'] !== null && !Array.isArray(p['args'])
        ? (p['args'] as Record<string, unknown>)
        : undefined;
    const merged = shallowMergeActionParams(executeParamsFromItem(item), triggerArgs);
    const result = this.graphStore.activateScene(scene.guid, message.location, 'runtime');
    this.sendResultToSource(ws, result);
    this.publishMutation(ws, result, message.location);

    const animGuid =
      typeof merged['animationGuid'] === 'string' && merged['animationGuid'].length > 0
        ? merged['animationGuid']
        : undefined;
    if (animGuid && this.animationManager && Object.prototype.hasOwnProperty.call(merged, 'value')) {
      const loc = message.location;
      const stopLikeOpts = loc !== undefined ? { location: loc } : undefined;
      if (isActiveTriggerValue(merged['value'])) {
        const opts: { location?: [number, number]; timescale?: number } = {};
        if (loc !== undefined) {
          opts.location = loc;
        }
        this.animationManager.trigger(animGuid, opts);
      } else {
        this.animationManager.stop(animGuid, stopLikeOpts);
      }
    }
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

    const merged = shallowMergeActionParams(executeParamsFromItem(item), triggerArgs);
    const branch = resolveIntentOrAnimationBranches(merged);
    if (!branch.ok) {
      Logger.warn(`[action] animation trigger: ${branch.reason}`);
      return 0;
    }
    const resolved = branch.resolved;

    const cmd = normalizedAnimationTriggerCommand(resolved);
    const stopLikeOpts = location !== undefined ? { location } : undefined;

    switch (cmd) {
      case 'stop':
        this.animationManager.stop(item.guid, stopLikeOpts);
        return 1;
      case 'pause':
        this.animationManager.pause(item.guid, stopLikeOpts);
        return 1;
      case 'settimescale': {
        const ts = resolved['timescale'];
        if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) {
          Logger.warn('[action] animation setTimescale requires args.timescale (finite number > 0)');
          return 0;
        }
        this.animationManager.setTimescale(item.guid, ts);
        return 1;
      }
      case 'start':
      default: {
        if (cmd !== 'start') {
          Logger.warn(`[action] unknown animation args.command "${cmd}" — treating as start`);
        }
        const opts: { location?: [number, number]; timescale?: number } = {};
        if (location !== undefined) {
          opts.location = location;
        }
        const ts = resolved['timescale'];
        if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) {
          opts.timescale = ts;
        }
        this.animationManager.trigger(item.guid, opts);
        return 1;
      }
    }
  }

  private executeIntentItem(
    ws: WebSocket,
    item: ActionExecuteItem,
    sourceGuid: string,
    triggerArgs: Record<string, unknown> | undefined,
    location?: [number, number]
  ): number {
    const merged = shallowMergeActionParams(executeParamsFromItem(item), triggerArgs);
    const branch = resolveIntentOrAnimationBranches(merged);
    if (!branch.ok) {
      Logger.warn(`[action] intent trigger: ${branch.reason}`);
      return 0;
    }
    const update = this.intentExecuteItemToRuntimeUpdate(item, sourceGuid, branch.resolved);
    if (!update) return 0;
    this.runtimeUpdateDispatcher.dispatch([update], location, Date.now(), new Set([ws]));
    return 1;
  }

  private intentExecuteItemToRuntimeUpdate(
    item: ActionExecuteItem,
    sourceGuid: string,
    resolvedPatch: Record<string, unknown>,
  ): RuntimeUpdate | null {
    if (item.type !== 'intent' || typeof item.guid !== 'string' || item.guid.length === 0) {
      Logger.warn('[action] invalid intent execute item');
      return null;
    }
    const itemRecord = item as Record<string, unknown>;
    const explicitPatch = this.recordOrUndefined(itemRecord['patch']);
    const patch = {
      ...resolvedPatch,
      ...(explicitPatch ?? {}),
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
