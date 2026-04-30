import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { ProjectManager } from '../ProjectManager';

interface SaveProjectPayload {
  key: string;
  data: unknown;
}

const ALLOWED_TOP_KEYS = new Set(['scenes']);

function isSaveProjectPayload(payload: unknown): payload is SaveProjectPayload {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return typeof p['key'] === 'string' && p['key'].length > 0;
}

export class SaveProjectHandler implements MessageHandler {
  constructor(
    private projectManager: ProjectManager,
    private onChanged: () => void,
  ) {}

  handle(_ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    if (!isSaveProjectPayload(message.payload)) {
      Logger.warn('[saveProject] invalid payload — expected { key, data }');
      return;
    }

    const topKey = message.payload.key.split('.')[0]!;
    if (!ALLOWED_TOP_KEYS.has(topKey)) {
      Logger.warn(`[saveProject] key "${message.payload.key}" rejected — "${topKey}" not in allowlist`);
      return;
    }

    this.projectManager.setProjectData(message.payload.key, message.payload.data);
    this.onChanged();
    const dataDesc = Array.isArray(message.payload.data)
      ? `array(${message.payload.data.length})`
      : typeof message.payload.data;
    Logger.info(`[saveProject] saved key "${message.payload.key}" (${dataDesc})`);
  }
}
