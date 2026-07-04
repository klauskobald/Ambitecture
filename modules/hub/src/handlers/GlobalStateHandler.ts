import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { globalState } from '../GlobalState';

/**
 * Allowlisted `globalState:set` payloads. Controllers may only set keys enumerated here — extend the
 * union and the guard when adding a new global key. Prevents arbitrary key writes from a controller.
 */
type GlobalStateSetPayload = { key: 'editmode'; value: boolean };

function isGlobalStateSetPayload(payload: unknown): payload is GlobalStateSetPayload {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const rec = payload as Record<string, unknown>;
  return rec['key'] === 'editmode' && typeof rec['value'] === 'boolean';
}

export class GlobalStateHandler implements MessageHandler {
  constructor(private registry: ConnectionRegistry) {}

  handle(ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    const info = this.registry.get(ws);
    if (info?.role !== 'controller') {
      Logger.warn('[globalState] ignored set — sender is not a controller');
      return;
    }
    if (!isGlobalStateSetPayload(message.payload)) {
      Logger.warn('[globalState] invalid globalState:set payload');
      return;
    }
    globalState.setItem(message.payload.key, message.payload.value);
  }
}
