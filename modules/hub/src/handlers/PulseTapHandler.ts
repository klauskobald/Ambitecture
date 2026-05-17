import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { PulseTapTempo } from '../pulse/PulseTapTempo';
import { PulseTapTempoConfig } from '../pulse/PulseTapTempoConfig';
import { PulseManager } from '../pulse/PulseManager';
import { PulseSetupManager } from '../pulse/PulseSetupManager';
import { ProjectManager } from '../ProjectManager';

function isPulseTapPayload(payload: unknown): payload is { setupGuid: string; atMs?: number } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;
  return typeof p['setupGuid'] === 'string' && p['setupGuid'].length > 0
    && (p['atMs'] === undefined || typeof p['atMs'] === 'number');
}

export class PulseTapHandler implements MessageHandler {
  private readonly tempo: PulseTapTempo;

  constructor(
    private registry: ConnectionRegistry,
    config: PulseTapTempoConfig,
    pulseManager: PulseManager,
    pulseSetupManager: PulseSetupManager,
    private projectManager: ProjectManager,
  ) {
    this.tempo = new PulseTapTempo(
      config,
      pulseManager,
      pulseSetupManager,
      projectManager,
      () => this.broadcastPulsesPatch(),
    );
  }

  handle(ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    const info = this.registry.get(ws);
    if (!info || info.role !== 'controller') {
      Logger.warn('[pulse] pulse:tap ignored — sender is not a controller');
      return;
    }

    if (!isPulseTapPayload(message.payload)) {
      Logger.warn('[pulse] invalid pulse:tap payload');
      return;
    }

    const { setupGuid, atMs } = message.payload;
    this.tempo.recordTap(setupGuid, atMs);
  }

  broadcastPulsesPatch(): void {
    const data = this.projectManager.getPulsesWirePayload();
    const patch = JSON.stringify({
      message: { type: 'projectPatch', payload: { key: 'pulses', data } },
    });
    for (const controllerWs of this.registry.getByRole('controller')) {
      if (controllerWs.readyState !== WebSocket.OPEN) continue;
      controllerWs.send(patch);
    }
  }
}
