import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { ActionInputCommand, ActionInputManager } from '../ActionInputManager';
import { GraphMutationResult } from '../GraphProtocol';
import { ProjectGraphStore } from '../ProjectGraphStore';

type ActionTriggerPayload = {
  actionGuid: string;
};

function isActionInputCommand(payload: unknown): payload is ActionInputCommand {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;
  switch (p['command']) {
    case 'ensureSceneButton':
    case 'disableSceneButton':
      return typeof p['sceneGuid'] === 'string' && p['sceneGuid'].length > 0;
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
  return typeof (payload as Record<string, unknown>)['actionGuid'] === 'string';
}

export class ActionHandler implements MessageHandler {
  constructor(
    private registry: ConnectionRegistry,
    private graphStore: ProjectGraphStore,
    private actionInputManager: ActionInputManager,
    private publishMutation: (source: WebSocket, result: GraphMutationResult, location?: [number, number]) => void,
  ) {}

  handle(ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    const info = this.registry.get(ws);
    if (info?.role !== 'controller') {
      Logger.warn('[action] ignored — sender is not a controller');
      return;
    }

    switch (message.type) {
      case 'action:input':
        this.handleInputCommand(ws, message);
        break;
      case 'action:trigger':
        this.handleTrigger(ws, message);
        break;
      default:
        Logger.warn(`[action] unknown message type: ${message.type}`);
        break;
    }
  }

  private handleInputCommand(ws: WebSocket, message: WsMessage): void {
    if (!isActionInputCommand(message.payload)) {
      Logger.warn('[action] invalid action:input payload');
      return;
    }
    const commands = this.actionInputManager.buildCommands(message.payload);
    for (const command of commands) {
      const result = this.graphStore.applyGraphCommand(command);
      this.sendResultToSource(ws, result);
      this.publishMutation(ws, result, message.location);
    }
  }

  private handleTrigger(ws: WebSocket, message: WsMessage): void {
    if (!isActionTriggerPayload(message.payload)) {
      Logger.warn('[action] invalid action:trigger payload');
      return;
    }
    const action = this.actionInputManager.getAction(message.payload.actionGuid);
    if (!action) {
      Logger.warn(`[action] action ${message.payload.actionGuid} not found`);
      return;
    }
    const scene = this.actionInputManager.getSceneForAction(action);
    if (!scene?.name) {
      Logger.warn(`[action] action ${message.payload.actionGuid} has no supported scene target`);
      return;
    }
    const result = this.graphStore.activateScene(scene.name, message.location);
    this.sendResultToSource(ws, result);
    this.publishMutation(ws, result, message.location);
    Logger.info(`[action] triggered ${action.guid ?? message.payload.actionGuid} → scene "${scene.name}"`);
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
