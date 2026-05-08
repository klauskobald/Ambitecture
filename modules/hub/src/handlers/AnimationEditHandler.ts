import { WebSocket } from 'ws';
import type { MessageHandler, WsMessage } from '../MessageRouter';
import type { ConnectionRegistry } from '../ConnectionRegistry';
import type { AnimationManager } from '../animation/AnimationManager';
import { Logger } from '../Logger';

interface AnimationEditPayload {
  animationGuid: string;
  on: boolean;
}

function isAnimationEditPayload(p: unknown): p is AnimationEditPayload {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  const r = p as Record<string, unknown>;
  return typeof r['animationGuid'] === 'string'
    && r['animationGuid'].length > 0
    && typeof r['on'] === 'boolean';
}

/**
 * `animation:edit` — controller-driven entry/exit of an animator's live edit mode.
 * The animator itself owns its editState shape and bindings. This handler only dispatches.
 */
export class AnimationEditHandler implements MessageHandler {
  constructor(
    private registry: ConnectionRegistry,
    private animationManager: AnimationManager,
  ) { }

  handle(ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    if (this.registry.get(ws)?.role !== 'controller') {
      Logger.warn('[animation:edit] ignored — sender is not a controller');
      return;
    }
    if (!isAnimationEditPayload(message.payload)) {
      Logger.warn('[animation:edit] invalid payload');
      return;
    }
    const { animationGuid, on } = message.payload;
    if (on) {
      const opts = message.location !== undefined ? { location: message.location } : {};
      this.animationManager.enterEditMode(animationGuid, opts);
    } else {
      this.animationManager.exitEditMode(animationGuid);
    }
  }
}
