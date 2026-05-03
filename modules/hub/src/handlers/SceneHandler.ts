import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { ProjectManager, ControllerIntent } from '../ProjectManager';
import { EventQueue } from '../EventQueue';
import { RuntimeUpdateDispatcher } from '../RuntimeUpdateDispatcher';
import { normalizeIntentColor, intentToEvent, intentRemovalEvent } from './intentHelpers';

interface SceneActivatePayload {
  sceneName: string;
}

function isSceneActivatePayload(payload: unknown): payload is SceneActivatePayload {
  if (!payload || typeof payload !== 'object') return false;
  return typeof (payload as Record<string, unknown>)['sceneName'] === 'string';
}

export class SceneHandler implements MessageHandler {
  constructor(
    private registry: ConnectionRegistry,
    private projectManager: ProjectManager,
    private eventQueue: EventQueue,
    private runtimeUpdateDispatcher?: RuntimeUpdateDispatcher,
  ) {}

  handle(ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    const info = this.registry.get(ws);
    if (info?.role !== 'controller') {
      Logger.warn('[scene] ignored — sender is not a controller');
      return;
    }

    switch (message.type) {
      case 'scene:activate': {
        if (!isSceneActivatePayload(message.payload)) {
          Logger.warn('[scene] invalid scene:activate payload');
          return;
        }
        this.runtimeUpdateDispatcher?.clearRuntimeIntentMergeCache();
        const newIntents = this.projectManager.setActiveScene(message.payload.sceneName);

        const now = Date.now();
        const newGuids = new Set(newIntents.map(i => i.guid));

        // Zero-alpha events for ALL project intents not in the new scene
        const removalEntries = this.projectManager.getAllIntentDefinitionGuids()
          .filter(guid => !newGuids.has(guid))
          .map(guid => this.projectManager.getIntentDefinition(guid))
          .filter((i): i is ControllerIntent => i !== undefined)
          .map(normalizeIntentColor)
          .map(intent => ({
            event: intentRemovalEvent(intent, now),
            scheduledAt: now,
          }));

        // Full events for new scene intents
        const activeEntries = newIntents
          .map(normalizeIntentColor)
          .map(intent => ({
            event: intentToEvent(intent, now + (intent.scheduled ?? 0)),
            scheduledAt: now + (intent.scheduled ?? 0),
          }));

        this.eventQueue.schedule([...removalEntries, ...activeEntries], message.location);

        // Broadcast scene state to all controllers
        const controllers = this.registry.getByRole('controller')
          .filter(c => c.readyState === WebSocket.OPEN);
        const stateMsg = JSON.stringify({
          message: {
            type: 'scene:state',
            payload: { sceneName: message.payload.sceneName, intents: newIntents },
          },
        });
        const scenesWire = this.projectManager.getScenesWirePayload();
        for (const controllerWs of controllers) {
          controllerWs.send(stateMsg);
          const cinfo = this.registry.get(controllerWs);
          if (!cinfo) continue;
          const intentWire = this.projectManager.getControllerIntents(cinfo.guid);
          controllerWs.send(
            JSON.stringify({
              message: {
                type: 'projectPatch',
                payload: { key: 'intents', data: intentWire },
              },
            })
          );
          controllerWs.send(
            JSON.stringify({
              message: {
                type: 'projectPatch',
                payload: { key: 'scenes', data: scenesWire },
              },
            })
          );
        }

        Logger.info(`[scene] controller ${info.guid} activated scene "${message.payload.sceneName}": ${removalEntries.length} removed, ${activeEntries.length} active`);
        break;
      }
      default:
        Logger.warn(`[scene] Unknown scene message type: ${message.type}`);
    }
  }
}
