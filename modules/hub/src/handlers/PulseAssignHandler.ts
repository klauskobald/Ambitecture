import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import {
  PulseAssignCommand,
  PulseBucketAssignManager,
} from '../pulse/PulseBucketAssignManager';
import { ProjectGraphStore } from '../ProjectGraphStore';
import { ProjectManager } from '../ProjectManager';
import { GraphMutationResult } from '../GraphProtocol';

function isPulseAssignCommand(payload: unknown): payload is PulseAssignCommand {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;
  switch (p['command']) {
    case 'linkAnimationToBucket':
    case 'unlinkAnimationFromBucket':
      return typeof p['bucketGuid'] === 'string'
        && p['bucketGuid'].length > 0
        && typeof p['animationGuid'] === 'string'
        && p['animationGuid'].length > 0;
    case 'createBucket':
      return p['name'] === undefined || typeof p['name'] === 'string';
    case 'createBucketAssignment':
      return typeof p['animationGuid'] === 'string'
        && p['animationGuid'].length > 0
        && (p['name'] === undefined || typeof p['name'] === 'string');
    case 'renameBucket':
      return typeof p['bucketGuid'] === 'string'
        && p['bucketGuid'].length > 0
        && typeof p['name'] === 'string';
    case 'deleteBucket':
      return typeof p['bucketGuid'] === 'string' && p['bucketGuid'].length > 0;
    default:
      return false;
  }
}

export class PulseAssignHandler implements MessageHandler {
  constructor(
    private registry: ConnectionRegistry,
    private graphStore: ProjectGraphStore,
    private pulseBucketAssignManager: PulseBucketAssignManager,
    private projectManager: ProjectManager,
    private publishMutation: (source: WebSocket, result: GraphMutationResult, location?: [number, number]) => void,
  ) {}

  handle(ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    const info = this.registry.get(ws);
    if (!info || info.role !== 'controller') {
      Logger.warn('[pulse] ignored — sender is not a controller');
      return;
    }

    if (!isPulseAssignCommand(message.payload)) {
      Logger.warn('[pulse] invalid pulse:assign payload');
      return;
    }

    const result = this.pulseBucketAssignManager.build(message.payload);
    for (const command of result.graphCommands) {
      const mutation = this.graphStore.applyGraphCommand(command, message.location);
      this.sendResultToSource(ws, mutation);
      this.publishMutation(ws, mutation, message.location);
    }

    if (result.pulsesChanged) {
      this.broadcastPulsesPatch();
    }
  }

  private sendResultToSource(ws: WebSocket, result: GraphMutationResult): void {
    if (result.controllerDeltas.length === 0 || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      message: {
        type: 'graph:delta',
        payload: result.controllerDeltas,
      },
    }));
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
