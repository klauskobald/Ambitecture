import { WebSocket } from 'ws';
import { ConnectionRegistry } from './ConnectionRegistry';
import { EventQueue } from './EventQueue';
import { RuntimeIntentStore } from './RuntimeIntentStore';
import { RuntimeUpdate } from './RuntimeProtocol';

export class RuntimeUpdateDispatcher {
  private updateListener?: (updates: RuntimeUpdate[]) => void;

  constructor(
    private registry: ConnectionRegistry,
    private eventQueue: EventQueue,
    private runtimeIntentStore: RuntimeIntentStore,
  ) {}

  /** Observe every dispatched update (e.g. the physics adapter wakes on external intent moves). */
  setUpdateListener(listener: (updates: RuntimeUpdate[]) => void): void {
    this.updateListener = listener;
  }

  /** Delegates to {@link RuntimeIntentStore.clear} — same invalidation triggers as before. */
  clearRuntimeIntentMergeCache(): void {
    this.runtimeIntentStore.clear();
  }

  /** Remove runtime merge overlays only for listed intent GUIDs. */
  evictRuntimeIntentMergeGuids(guids: string[]): void {
    if (guids.length === 0) return;
    this.runtimeIntentStore.evictMergeGuids(guids);
  }

  /**
   * `@param excludeControllerSockets` — when each sender should also receive `runtime:update`,
   * pass `undefined` so the performing controller applies the same merge as the hub (dumb replica).
   */
  dispatch(
    updates: RuntimeUpdate[],
    location?: [number, number],
    now = Date.now(),
    excludeControllerSockets?: Set<WebSocket>,
  ): void {
    if (updates.length === 0) return;

    this.updateListener?.(updates);
    this.forwardRuntimeUpdates(updates, location, excludeControllerSockets);
    const rendererEvents = this.runtimeIntentStore.processRuntimeUpdates(updates, now);
    if (rendererEvents.length > 0) {
      this.eventQueue.schedule(rendererEvents.map(event => ({ event, scheduledAt: now })), location);
    }
  }

  private forwardRuntimeUpdates(
    updates: RuntimeUpdate[],
    location?: [number, number],
    excludeControllerSockets?: Set<WebSocket>,
  ): void {
    const outbound = JSON.stringify({
      message: {
        type: 'runtime:update',
        ...(location !== undefined ? { location } : {}),
        payload: updates,
      },
    });
    for (const ws of this.registry.getControllersSubscribedToRuntime()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (excludeControllerSockets?.has(ws)) continue;
      ws.send(outbound);
    }
  }
}
