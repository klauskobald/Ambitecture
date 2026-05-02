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
    const result = this.graphStore.applyGraphCommand(message.payload);
    this.publishMutation(ws, result, message.location);
    Logger.info(`[graph] ${message.payload.op} ${message.payload.entityType}:${message.payload.guid} from ${info.guid}`);
  }
}
