import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import {
  PulseControlCommand,
  PulseSetupManager,
} from '../pulse/PulseSetupManager';
import { PulseManager } from '../pulse/PulseManager';
import { ProjectManager } from '../ProjectManager';

function isPulseControlCommand(payload: unknown): payload is PulseControlCommand {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;
  switch (p['command']) {
    case 'selectSetup':
      return typeof p['setupGuid'] === 'string' && p['setupGuid'].length > 0;
    case 'createSetup':
      return (p['name'] === undefined || typeof p['name'] === 'string')
        && (p['bpm'] === undefined || typeof p['bpm'] === 'number')
        && (p['slotCount'] === undefined || typeof p['slotCount'] === 'number');
    case 'deleteSetup':
      return typeof p['setupGuid'] === 'string' && p['setupGuid'].length > 0;
    case 'renameSetup':
      return typeof p['setupGuid'] === 'string'
        && p['setupGuid'].length > 0
        && typeof p['name'] === 'string';
    case 'setSetupBpm':
      return typeof p['setupGuid'] === 'string'
        && p['setupGuid'].length > 0
        && typeof p['bpm'] === 'number';
    case 'setSetupSpeed':
      return typeof p['setupGuid'] === 'string'
        && p['setupGuid'].length > 0
        && typeof p['speed'] === 'number';
    case 'setSetupSlotCount':
      return typeof p['setupGuid'] === 'string'
        && p['setupGuid'].length > 0
        && typeof p['count'] === 'number';
    case 'setSetupMode':
      return typeof p['setupGuid'] === 'string'
        && p['setupGuid'].length > 0
        && (p['mode'] === 'forward' || p['mode'] === 'backward' || p['mode'] === 'random');
    case 'assignSlotBucket':
      return typeof p['setupGuid'] === 'string'
        && p['setupGuid'].length > 0
        && typeof p['slotIdx'] === 'number'
        && (p['bucketGuid'] === null || typeof p['bucketGuid'] === 'string');
    case 'setSlotActive':
      return typeof p['setupGuid'] === 'string'
        && p['setupGuid'].length > 0
        && typeof p['slotIdx'] === 'number'
        && typeof p['active'] === 'boolean';
    case 'setSyncConfig':
      return (p['enabled'] === undefined || typeof p['enabled'] === 'boolean')
        && (p['restart'] === undefined
          || p['restart'] === 'never'
          || p['restart'] === 'bar'
          || p['restart'] === 'onset')
        && (p['lerp'] === undefined || typeof p['lerp'] === 'number');
    default:
      return false;
  }
}

export class PulseControlHandler implements MessageHandler {
  constructor(
    private registry: ConnectionRegistry,
    private pulseSetupManager: PulseSetupManager,
    private pulseManager: PulseManager,
    private projectManager: ProjectManager,
  ) {}

  handle(ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    const info = this.registry.get(ws);
    if (!info || info.role !== 'controller') {
      Logger.warn('[pulse] pulse:control ignored — sender is not a controller');
      return;
    }

    if (!isPulseControlCommand(message.payload)) {
      Logger.warn('[pulse] invalid pulse:control payload');
      return;
    }

    const cmd = message.payload;

    if (cmd.command === 'selectSetup') {
      this.pulseManager.selectSetup(cmd.setupGuid);
      return;
    }

    if (cmd.command === 'deleteSetup') {
      const activeGuid = this.pulseManager.getActiveSetupGuid();
      if (activeGuid === cmd.setupGuid) {
        this.pulseManager.stop();
      }
    }

    const result = this.pulseSetupManager.build(cmd);

    if (result.setupGuid && cmd.command === 'setSetupBpm') {
      if (this.pulseManager.getActiveSetupGuid() === result.setupGuid) {
        const setup = this.projectManager.getPulseSetup(result.setupGuid);
        if (setup) {
          this.pulseManager.setBPM(setup.bpm);
        }
      }
    }

    if (result.pulsesChanged) {
      this.broadcastPulsesPatch();
      this.pulseManager.syncActiveSetupFromProject();
    }
  }

  private broadcastPulsesPatch(): void {
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
