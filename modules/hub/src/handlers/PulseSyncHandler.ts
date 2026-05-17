import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { HubStatusDispatcher } from '../hubStatusTypes';
import { PulseSync, PulseSyncKind, PulseSyncPayload } from '../pulse/PulseSync';

function isPulseSyncKind(value: unknown): value is PulseSyncKind {
  return value === 'onset' || value === 'bar';
}

function isPulseSyncPayload(payload: unknown): payload is PulseSyncPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const p = payload as Record<string, unknown>;
  if (typeof p['bpm'] !== 'number' || !Number.isFinite(p['bpm'])) {
    return false;
  }
  if (typeof p['beatAtMs'] !== 'number' || !Number.isFinite(p['beatAtMs'])) {
    return false;
  }
  if (typeof p['sentAtMs'] !== 'number' || !Number.isFinite(p['sentAtMs'])) {
    return false;
  }
  if (!isPulseSyncKind(p['kind'])) {
    return false;
  }
  if (p['phaseAdjustMs'] !== undefined
    && (typeof p['phaseAdjustMs'] !== 'number' || !Number.isFinite(p['phaseAdjustMs']))) {
    return false;
  }
  if (p['audioT'] !== undefined
    && (typeof p['audioT'] !== 'number' || !Number.isFinite(p['audioT']))) {
    return false;
  }
  if (p['spectrum'] !== undefined) {
    if (!Array.isArray(p['spectrum'])) {
      return false;
    }
    for (const bin of p['spectrum']) {
      if (typeof bin !== 'number' || !Number.isFinite(bin)) {
        return false;
      }
    }
  }
  return true;
}

export class PulseSyncHandler implements MessageHandler {
  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly pulseSync: PulseSync,
    private readonly hubStatus: HubStatusDispatcher,
  ) { }

  handle(ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    const info = this.registry.get(ws);
    if (!info || info.role !== 'controller') {
      Logger.warn('[pulse] pulse:sync ignored — sender is not a controller');
      return;
    }

    if (!isPulseSyncPayload(message.payload)) {
      Logger.warn('[pulse] invalid pulse:sync payload');
      return;
    }

    this.hubStatus.broadcastPulseSyncRx(message.payload.kind);
    this.pulseSync.apply(message.payload);
  }
}
