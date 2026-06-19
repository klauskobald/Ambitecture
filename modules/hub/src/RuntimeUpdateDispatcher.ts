import { WebSocket } from 'ws';
import { ConnectionRegistry } from './ConnectionRegistry';
import { EventQueue } from './EventQueue';
import { RuntimeIntentStore } from './RuntimeIntentStore';
import { RuntimeUpdate } from './RuntimeProtocol';

export class RuntimeUpdateDispatcher {
  private updateInterceptor?: (updates: RuntimeUpdate[]) => RuntimeUpdate[];

  constructor(
    private registry: ConnectionRegistry,
    private eventQueue: EventQueue,
    private runtimeIntentStore: RuntimeIntentStore,
  ) {}

  /**
   * Intercept every dispatched update batch and return the subset to actually forward/apply. The
   * physics adapter uses this to *claim* a dragged intent (redirecting the raw position into a spring
   * anchor and owning the intent's rendered position itself) — those claimed updates are dropped here.
   */
  setUpdateInterceptor(interceptor: (updates: RuntimeUpdate[]) => RuntimeUpdate[]): void {
    this.updateInterceptor = interceptor;
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

    const effective = this.updateInterceptor ? this.updateInterceptor(updates) : updates;
    if (effective.length === 0) return;

    this.forwardRuntimeUpdates(effective, location, excludeControllerSockets);
    const rendererEvents = this.runtimeIntentStore.processRuntimeUpdates(effective, now);
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
