import type { ConnectionRegistry } from './ConnectionRegistry';

export type AnimationRunStatus = 'started' | 'paused' | 'stopped';

/** `hub:status` payload when `kind === 'animation'`. */
export type HubStatusAnimationPayload = {
  kind: 'animation';
  animationGuid: string;
  status: AnimationRunStatus;
  message: { text: string };
  data: Record<string, unknown>;
};

export type HubStatusPayload = HubStatusAnimationPayload;

/**
 * Fan-out hub-originated status to all controllers (same idea as {@link RuntimeUpdateDispatcher}).
 * Inbound clients never send this type.
 */
export class HubStatusDispatcher {
  constructor(private registry: ConnectionRegistry) {}

  broadcastAnimationStatus(
    payload: HubStatusAnimationPayload,
    location?: [number, number],
  ): void {
    const outbound = JSON.stringify({
      message: {
        type: 'hub:status',
        ...(location !== undefined ? { location } : {}),
        payload,
      },
    });
    for (const ws of this.registry.getByRole('controller')) {
      if (ws.readyState !== ws.OPEN) continue;
      ws.send(outbound);
    }
  }

  /** Fan-out `lock:intent` — controllers only (`animation-started` / `animation-stopped`, etc.). */
  broadcastIntentLock(
    payload: { guid: string; reason: string },
    location?: [number, number],
  ): void {
    const outbound = JSON.stringify({
      message: {
        type: 'lock:intent',
        ...(location !== undefined ? { location } : {}),
        payload,
      },
    });
    for (const ws of this.registry.getByRole('controller')) {
      if (ws.readyState !== ws.OPEN) continue;
      ws.send(outbound);
    }
  }
}
