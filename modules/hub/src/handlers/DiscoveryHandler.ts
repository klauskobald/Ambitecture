import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { DiscoveryService } from '../DiscoveryService';

export class DiscoveryHandler implements MessageHandler {
  constructor(private readonly discovery: DiscoveryService) {}

  handle(ws: WebSocket, message: WsMessage, registry: ConnectionRegistry): void {
    if (message.type !== 'discovery:subscribe') return;
    const info = registry.get(ws);
    if (info?.role !== 'controller') {
      Logger.warn('[discovery] ignored subscribe — sender is not a controller');
      return;
    }
    this.discovery.subscribe(ws);
  }
}
