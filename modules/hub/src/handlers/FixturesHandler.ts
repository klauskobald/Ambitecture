import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { FixtureMoveUpdate, ProjectManager } from '../ProjectManager';

interface FixtureMovePayload {
  zoneName: string;
  fixtureName: string;
  position: [number, number, number];
}

function isTuple3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function isFixtureMovePayload(payload: unknown): payload is FixtureMovePayload[] {
  return Array.isArray(payload) && payload.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const p = item as Record<string, unknown>;
    return typeof p['zoneName'] === 'string'
      && typeof p['fixtureName'] === 'string'
      && isTuple3(p['position']);
  });
}

export class FixturesHandler implements MessageHandler {
  constructor(
    private registry: ConnectionRegistry,
    private projectManager: ProjectManager,
    private onProjectStateChanged: () => void,
  ) {}

  handle(ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    const info = this.registry.get(ws);
    if (info?.role !== 'controller') {
      Logger.warn('[fixtures] ignored — sender is not a controller');
      return;
    }
    if (!isFixtureMovePayload(message.payload)) {
      Logger.warn('[fixtures] payload is not a valid fixture move array');
      return;
    }
    const updates: FixtureMoveUpdate[] = message.payload.map((item) => ({
      zoneName: item.zoneName,
      fixtureName: item.fixtureName,
      position: item.position,
    }));
    const changed = this.projectManager.updateFixtures(updates);
    if (changed > 0) {
      this.onProjectStateChanged();
    }
    Logger.info(`[fixtures] ${updates.length} update(s) from ${info.guid}, applied ${changed}`);
  }
}
