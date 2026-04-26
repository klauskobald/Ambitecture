import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';

interface RegisterPayload {
  role: 'renderer' | 'controller';
  guid: string;
  location?: [number, number];
  positionOrigin?: unknown;
  boundingBox?: unknown;
  scope?: unknown;
}

function isRegisterPayload(payload: unknown): payload is RegisterPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const p = payload as Record<string, unknown>;
  return (p['role'] === 'renderer' || p['role'] === 'controller') && typeof p['guid'] === 'string';
}

export class RegisterHandler implements MessageHandler {
  private registry: ConnectionRegistry;

  constructor(registry: ConnectionRegistry) {
    this.registry = registry;
  }

  handle(ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    if (!isRegisterPayload(message.payload)) {
      Logger.warn('[register] Invalid register payload');
      return;
    }

    const { role, guid, location, positionOrigin, boundingBox, scope } = message.payload;

    const meta: Record<string, unknown> = {};
    if (positionOrigin !== undefined) {
      meta['positionOrigin'] = positionOrigin;
    }
    if (boundingBox !== undefined) {
      meta['boundingBox'] = boundingBox;
    }
    if (scope !== undefined) {
      meta['scope'] = scope;
    }

    const update: Parameters<ConnectionRegistry['update']>[1] = { role, guid, meta };
    if (location !== undefined) {
      update.location = location;
    }

    this.registry.update(ws, update);

    Logger.info(`[register] ${role} ${guid}`);
  }
}
