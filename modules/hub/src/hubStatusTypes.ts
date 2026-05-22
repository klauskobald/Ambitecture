import { WebSocket } from 'ws';
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

export type HubStatusPulsePayload = {
  kind: 'pulse';
  setupGuid: string;
  status: 'started' | 'stopped';
  message: { text: string };
  data: { bpm: number; slotIdx: number; slotsTotal: number; speed: number };
};

/** `hub:status` when an external controller sent `pulse:sync` (applied or not). */
export type HubStatusPulseSyncRxPayload = {
  kind: 'pulseSyncRx';
  message: { text: string };
  data: { syncKind: 'onset' | 'bar'; atMs: number; bpm: number };
};

export type HubStatusPayload =
  | HubStatusAnimationPayload
  | HubStatusPulsePayload
  | HubStatusPulseSyncRxPayload;

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
    this.broadcastHubStatus(payload, location);
  }

  broadcastPulseStatus(
    payload: HubStatusPulsePayload,
    location?: [number, number],
  ): void {
    this.broadcastHubStatus(payload, location);
  }

  broadcastPulseSyncRx(
    syncKind: 'onset' | 'bar',
    bpm: number,
    location?: [number, number],
  ): void {
    const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 0;
    const bpmLabel = safeBpm > 0 ? safeBpm.toFixed(1) : '?';
    const payload: HubStatusPulseSyncRxPayload = {
      kind: 'pulseSyncRx',
      message: { text: `sync ${syncKind} @ ${bpmLabel} BPM` },
      data: { syncKind, atMs: Date.now(), bpm: safeBpm },
    };
    this.broadcastHubStatus(payload, location);
  }

  private broadcastHubStatus(
    payload: HubStatusPayload,
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

  sendPulseStatusTo(
    ws: WebSocket,
    payload: HubStatusPulsePayload,
    location?: [number, number],
  ): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({
      message: {
        type: 'hub:status',
        ...(location !== undefined ? { location } : {}),
        payload,
      },
    }));
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
    for (const ws of this.registry.getControllersSubscribedToRuntime()) {
      if (ws.readyState !== ws.OPEN) continue;
      ws.send(outbound);
    }
  }
}
