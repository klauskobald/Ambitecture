import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { GraphMutationResult } from '../GraphProtocol';
import type { SnapshotManager, SnapshotCaptureInput } from '../snapshot/SnapshotManager';
import type { SnapshotRecallFlags } from '../ProjectManager';

function isSnapshotRecallFlags(value: unknown): value is SnapshotRecallFlags {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return typeof p['scene'] === 'boolean'
    && typeof p['pulse'] === 'boolean'
    && typeof p['animations'] === 'boolean';
}

function isSnapshotCapturePayload(payload: unknown): payload is SnapshotCaptureInput {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;
  const guid = p['guid'];
  const guidOk = guid === undefined || (typeof guid === 'string' && guid.length > 0);
  return typeof p['name'] === 'string'
    && isSnapshotRecallFlags(p['recall'])
    && guidOk;
}

export class SnapshotCaptureHandler implements MessageHandler {
  constructor(
    private registry: ConnectionRegistry,
    private snapshotManager: SnapshotManager,
    private publishMutation: (source: WebSocket | undefined, result: GraphMutationResult, location?: [number, number]) => void,
  ) { }

  handle(ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    const info = this.registry.get(ws);
    if (!info || info.role !== 'controller') {
      Logger.warn('[snapshot] snapshot:capture ignored — sender is not a controller');
      return;
    }
    if (!isSnapshotCapturePayload(message.payload)) {
      Logger.warn('[snapshot] invalid snapshot:capture payload');
      return;
    }
    const payload = message.payload;
    const input: SnapshotCaptureInput = {
      name: payload.name,
      recall: payload.recall,
      ...(payload.guid !== undefined ? { guid: payload.guid } : {}),
    };
    const result = this.snapshotManager.captureFromLive(input);
    if (result.controllerDeltas.length > 0 && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        message: {
          type: 'graph:delta',
          payload: result.controllerDeltas,
        },
      }));
    }
    this.publishMutation(ws, result, message.location);
  }
}
