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
  constructor(
    private registry: ConnectionRegistry,
    private projectManager: ProjectManager,
    private eventQueue: EventQueue,
  ) {}

  dispatch(updates: RuntimeUpdate[], location?: [number, number], now = Date.now()): void {
    if (updates.length === 0) return;

    this.forwardRuntimeUpdates(updates, location);
    const rendererEvents = this.runtimeUpdatesToRendererEvents(updates, now);
    if (rendererEvents.length > 0) {
      this.eventQueue.schedule(rendererEvents.map(event => ({ event, scheduledAt: now })), location);
    }
  }

  private forwardRuntimeUpdates(updates: RuntimeUpdate[], location?: [number, number]): void {
    const outbound = JSON.stringify({
      message: {
        type: 'runtime:update',
        ...(location !== undefined ? { location } : {}),
        payload: updates,
      },
    });
    for (const ws of this.registry.getByRole('controller')) {
      if (ws.readyState !== WebSocket.OPEN) continue;
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
    const existing = this.projectManager.getActiveSceneIntent(update.guid);
    if (!existing) {
      return null;
    }
    const intent = applyRuntimePatch(existing as unknown as Record<string, unknown>, update) as unknown as ControllerIntent;
    return intentToEvent(normalizeIntentColor(intent), now + (intent.scheduled ?? 0));
  }
}
