import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { ProjectGraphStore } from '../ProjectGraphStore';
import { GraphMutationResult, isGraphCommand } from '../GraphProtocol';

export class GraphCommandHandler implements MessageHandler {
  constructor(
    private registry: ConnectionRegistry,
    private graphStore: ProjectGraphStore,
    private publishMutation: (source: WebSocket, result: GraphMutationResult, location?: [number, number]) => void,
  ) {}

  handle(ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    const info = this.registry.get(ws);
    if (info?.role !== 'controller') {
      Logger.warn('[graph] ignored command — sender is not a controller');
      return;
    }
    if (!isGraphCommand(message.payload)) {
      Logger.warn('[graph] invalid graph:command payload');
      return;
    }
    const command = message.payload;
    const result = this.graphStore.applyGraphCommand(command, message.location);
    const sourceDeltas = result.controllerDeltas.filter(delta =>
      delta.entityType !== command.entityType
      || delta.guid !== command.guid
      || delta.op !== command.op
    );
    if (sourceDeltas.length > 0 && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ message: { type: 'graph:delta', payload: sourceDeltas } }));
    }
    this.publishMutation(ws, result, message.location);
    Logger.info(`[graph] ${command.op} ${command.entityType}:${command.guid} from ${info.guid}`);
  }
}
