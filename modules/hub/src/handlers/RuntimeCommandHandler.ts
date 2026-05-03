import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { RuntimeCommand, RuntimeUpdate, isRuntimeCommand } from '../RuntimeProtocol';
import { RuntimeUpdateDispatcher } from '../RuntimeUpdateDispatcher';

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
    private runtimeUpdateDispatcher: RuntimeUpdateDispatcher,
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

    this.runtimeUpdateDispatcher.dispatch(updates, location, this.lastFlushAt);
  }
}
