import { WebSocket } from 'ws';
import type { MessageHandler, WsMessage } from '../MessageRouter';
import type { ConnectionRegistry } from '../ConnectionRegistry';
import { BindingManager } from '../BindingManager';
import { isBindingSubscribeCommand, isBindingSetCommand } from '../BindingProtocol';
import { Logger } from '../Logger';

export class BindingHandler implements MessageHandler {
  constructor(
    private registry: ConnectionRegistry,
    private bindingManager: BindingManager,
  ) { }

  handle(ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    if (this.registry.get(ws)?.role !== 'controller') {
      Logger.warn('[binding] ignored — sender is not a controller');
      return;
    }

    switch (message.type) {
      case 'binding:subscribe': {
        if (!isBindingSubscribeCommand(message.payload)) {
          Logger.warn('[binding] invalid binding:subscribe payload');
          return;
        }
        this.bindingManager.handleSubscribe(ws, message.payload.key);
        break;
      }
      case 'binding:set': {
        if (!isBindingSetCommand(message.payload)) {
          Logger.warn('[binding] invalid binding:set payload');
          return;
        }
        this.bindingManager.handleSet(message.payload.key, message.payload.value);
        break;
      }
    }
  }
}
