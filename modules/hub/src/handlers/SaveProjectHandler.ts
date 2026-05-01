import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { ProjectManager } from '../ProjectManager';

interface SaveProjectPayload {
  key: string;
  data: unknown;
}

function isSaveProjectPayload(payload: unknown): payload is SaveProjectPayload {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return typeof p['key'] === 'string' && p['key'].length > 0;
}

export class SaveProjectHandler implements MessageHandler {
  constructor(
    private projectManager: ProjectManager,
  ) {}

  handle(ws: WebSocket, message: WsMessage, registry: ConnectionRegistry): void {
    if (!isSaveProjectPayload(message.payload)) {
      Logger.warn('[saveProject] invalid payload — expected { key, data }');
      return;
    }

    const { key, data } = message.payload;
    this.projectManager.setProjectData(key, data);

    const patch = JSON.stringify({
      message: { type: 'projectPatch', payload: { key, data } },
    });

    for (const controllerWs of registry.getByRole('controller')) {
      if (controllerWs === ws || controllerWs.readyState !== WebSocket.OPEN) continue;
      controllerWs.send(patch);
    }

    const dataDesc = Array.isArray(data) ? `array(${data.length})` : typeof data;
    Logger.info(`[saveProject] patched key "${key}" (${dataDesc}) → broadcast to peers`);
  }
}
