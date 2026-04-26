import { WebSocket } from 'ws';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';

export class PingHandler implements MessageHandler {
  handle(ws: WebSocket, _message: WsMessage, _registry: ConnectionRegistry): void {
    ws.send(JSON.stringify({ message: { type: 'pong' } }));
  }
}
