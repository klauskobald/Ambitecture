import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { ProjectManager, ControllerIntent } from '../ProjectManager';
import { EventQueue } from '../EventQueue';
import { RuntimeCommand, RuntimeUpdate, isRuntimeCommand } from '../RuntimeProtocol';
import { intentToEvent, normalizeIntentColor } from './intentHelpers';
import { cloneRecord, removeAtDotPath, setAtDotPath } from '../dotPath';

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

function mergeRuntimeUpdate(existing: RuntimeUpdate | undefined, next: RuntimeUpdate): RuntimeUpdate {
  if (!existing) return next;
  return {
    ...existing,
    ...next,
    patch: {
      ...(existing.patch ?? {}),
      ...(next.patch ?? {}),
    },
    remove: [
      ...(existing.remove ?? []),
      ...(next.remove ?? []),
    ],
  };
}

export class RuntimeCommandHandler implements MessageHandler {
  private pending = new Map<string, RuntimeUpdate>();
  private flushPending = false;
  private lastFlushAt = 0;
  private readonly minIntervalMs: number;

  constructor(
    private registry: ConnectionRegistry,
    private projectManager: ProjectManager,
    private eventQueue: EventQueue,
    rateLimitEventsPerSecond: number,
  ) {
    this.minIntervalMs = rateLimitEventsPerSecond > 0 ? 1000 / rateLimitEventsPerSecond : 40;
  }

  handle(ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    const info = this.registry.get(ws);
    if (info?.role !== 'controller') {
      Logger.warn('[runtime] ignored command — sender is not a controller');
      return;
    }
    if (!isRuntimeCommand(message.payload)) {
      Logger.warn('[runtime] invalid runtime:command payload');
      return;
    }

    const update = this.toRuntimeUpdate(message.payload, info.guid);
    const key = `${update.entityType}:${update.guid}`;
    this.pending.set(key, mergeRuntimeUpdate(this.pending.get(key), update));
    this.scheduleFlush(message.location);
  }

  private toRuntimeUpdate(command: RuntimeCommand, sourceGuid: string): RuntimeUpdate {
    return {
      ...command,
      source: sourceGuid,
    };
  }

  private scheduleFlush(location?: [number, number]): void {
    if (this.flushPending) return;
    const elapsed = Date.now() - this.lastFlushAt;
    if (elapsed >= this.minIntervalMs) {
      this.flush(location);
      return;
    }
    this.flushPending = true;
    setTimeout(() => {
      this.flushPending = false;
      this.flush(location);
    }, this.minIntervalMs - elapsed);
  }

  private flush(location?: [number, number]): void {
    const updates = [...this.pending.values()];
    if (updates.length === 0) return;
    this.pending.clear();
    this.lastFlushAt = Date.now();

    this.forwardRuntimeUpdates(updates, location);
    const rendererEvents = this.runtimeUpdatesToRendererEvents(updates, this.lastFlushAt);
    if (rendererEvents.length > 0) {
      this.eventQueue.schedule(rendererEvents.map(event => ({ event, scheduledAt: this.lastFlushAt })), location);
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
    const existing = this.projectManager.getIntentDefinition(update.guid);
    if (!existing) {
      return null;
    }
    const intent = applyRuntimePatch(existing as unknown as Record<string, unknown>, update) as unknown as ControllerIntent;
    return intentToEvent(normalizeIntentColor(intent), now + (intent.scheduled ?? 0));
  }
}
