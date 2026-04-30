import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { ProjectManager } from '../ProjectManager';
import { EventQueue } from '../EventQueue';
import { normalizeIntentColor, intentToEvent, zeroAlphaEvent } from './intentHelpers';
import { Scene } from '../ProjectManager';

interface SceneActivatePayload {
  sceneName: string;
}

interface SceneUpdatePayload {
  scenes: Scene[];
}

function isSceneActivatePayload(payload: unknown): payload is SceneActivatePayload {
  if (!payload || typeof payload !== 'object') return false;
  return typeof (payload as Record<string, unknown>)['sceneName'] === 'string';
}

function isSceneUpdatePayload(payload: unknown): payload is SceneUpdatePayload {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  if (!Array.isArray(p['scenes'])) return false;
  return (p['scenes'] as unknown[]).every(s => {
    if (!s || typeof s !== 'object') return false;
    const scene = s as Record<string, unknown>;
    return typeof scene['name'] === 'string' && Array.isArray(scene['intents']);
  });
}

export class SceneHandler implements MessageHandler {
  constructor(
    private registry: ConnectionRegistry,
    private projectManager: ProjectManager,
    private eventQueue: EventQueue,
    private onSceneChanged: () => void,
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
        const oldIntents = this.projectManager.getActiveSceneIntents();
        const newIntents = this.projectManager.setActiveScene(message.payload.sceneName);
        if (newIntents.length === 0 && oldIntents.length === 0) {
          Logger.info('[scene] activate — no intents in old or new scene, skipping');
          return;
        }

        const now = Date.now();
        const newGuids = new Set(newIntents.map(i => i.guid));

        // Zero-alpha events for intents removed from the scene
        const removalEntries = oldIntents
          .filter(i => i.guid && !newGuids.has(i.guid))
          .map(normalizeIntentColor)
          .map(intent => ({
            event: zeroAlphaEvent(intent, now),
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

        // Push updated configs to all modules (controllers get new scene state)
        this.onSceneChanged();

        // Broadcast scene state to all controllers
        const controllers = this.registry.getByRole('controller')
          .filter(c => c.readyState === WebSocket.OPEN);
        const stateMsg = JSON.stringify({
          message: {
            type: 'scene:state',
            payload: { sceneName: message.payload.sceneName, intents: newIntents },
          },
        });
        for (const controllerWs of controllers) {
          controllerWs.send(stateMsg);
        }

        Logger.info(`[scene] controller ${info.guid} activated scene "${message.payload.sceneName}": ${removalEntries.length} removed, ${activeEntries.length} active`);
        break;
      }
      case 'scene:update': {
        if (!isSceneUpdatePayload(message.payload)) {
          Logger.warn('[scene] invalid scene:update payload');
          return;
        }
        this.projectManager.updateScenes(message.payload.scenes);
        this.onSceneChanged();
        Logger.info(`[scene] controller ${info.guid} updated scenes: ${message.payload.scenes.length} scene(s)`);
        break;
      }
      default:
        Logger.warn(`[scene] Unknown scene message type: ${message.type}`);
    }
  }
}
