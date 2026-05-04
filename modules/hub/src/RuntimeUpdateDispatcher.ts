import { WebSocket } from 'ws';
import { ConnectionRegistry } from './ConnectionRegistry';
import { EventQueue } from './EventQueue';
import { ProjectManager, ControllerIntent } from './ProjectManager';
import { RuntimeUpdate } from './RuntimeProtocol';
import { cloneRecord, removeAtDotPath, setAtDotPath } from './dotPath';
import { intentToEvent, normalizeIntentColor } from './handlers/intentHelpers';

function applyRuntimePatch(base: Record<string, unknown>, update: RuntimeUpdate): Record<string, unknown> {
  const next = cloneRecord(update.value ?? base);
  next['guid'] = update.guid;
  for (const [key, value] of Object.entries(update.patch ?? {})) {
    setAtDotPath(next, key, value);
  }
  for (const key of update.remove ?? []) {
    removeAtDotPath(next, key);
  }
  return next;
}

export class RuntimeUpdateDispatcher {
  /** Last merged intent per guid for incremental `runtime:command` patches (hub project file is not updated on every drag). */
  private runtimeIntentMergeCache = new Map<string, Record<string, unknown>>();

  constructor(
    private registry: ConnectionRegistry,
    private projectManager: ProjectManager,
    private eventQueue: EventQueue,
  ) {}

  /** Drop cached merges when project/scene/intent definitions change so the next baseline matches disk. */
  clearRuntimeIntentMergeCache(): void {
    this.runtimeIntentMergeCache.clear();
  }

  /**
   * @param excludeControllerSockets Sockets that must not receive `runtime:update` (typically
   * the sender(s) of the underlying `runtime:command` batch). Use WebSocket identity — multiple
   * tabs can share the same controller config GUID.
   */
  dispatch(
    updates: RuntimeUpdate[],
    location?: [number, number],
    now = Date.now(),
    excludeControllerSockets?: Set<WebSocket>,
  ): void {
    if (updates.length === 0) return;

    this.forwardRuntimeUpdates(updates, location, excludeControllerSockets);
    const rendererEvents = this.runtimeUpdatesToRendererEvents(updates, now);
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
    for (const ws of this.registry.getByRole('controller')) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (excludeControllerSockets?.has(ws)) continue;
      ws.send(outbound);
    }
  }

  private runtimeUpdatesToRendererEvents(updates: RuntimeUpdate[], now: number): object[] {
    const events: object[] = [];
    for (const update of updates) {
      switch (update.entityType) {
        case 'intent': {
          const event = this.runtimeIntentUpdateToEvent(update, now);
          if (event) events.push(event);
          break;
        }
        default:
          break;
      }
    }
    return events;
  }

  private runtimeIntentUpdateToEvent(update: RuntimeUpdate, now: number): object | null {
    if (!this.projectManager.isIntentInActiveScene(update.guid)) {
      return null;
    }
    const fromProject = this.projectManager.getActiveSceneIntent(update.guid);
    if (!fromProject) {
      return null;
    }
    const previous = this.runtimeIntentMergeCache.get(update.guid);
    const baseline = previous ?? cloneRecord(fromProject as unknown as Record<string, unknown>);
    const intent = applyRuntimePatch(baseline, update) as unknown as ControllerIntent;
    this.runtimeIntentMergeCache.set(update.guid, cloneRecord(intent as unknown as Record<string, unknown>));
    return intentToEvent(normalizeIntentColor(intent), now + (intent.scheduled ?? 0));
  }
}
