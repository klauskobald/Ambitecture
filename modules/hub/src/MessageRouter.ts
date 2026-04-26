import { WebSocket } from 'ws';
import { Logger } from './Logger';
import { ConnectionRegistry } from './ConnectionRegistry';

export interface WsMessage {
  type: string;
  location?: [number, number];
  payload?: unknown;
}

export interface MessageHandler {
  handle(ws: WebSocket, message: WsMessage, registry: ConnectionRegistry): void;
}

export class MessageRouter {
  private handlers: Map<string, MessageHandler> = new Map();
  private registry: ConnectionRegistry;

  constructor(registry: ConnectionRegistry) {
    this.registry = registry;
  }

  register(type: string, handler: MessageHandler): void {
    this.handlers.set(type, handler);
  }

  route(ws: WebSocket, message: WsMessage): void {
    const handler = this.handlers.get(message.type);
    if (!handler) {
      Logger.warn(`[router] No handler for message type: ${message.type}`);
      return;
    }
    handler.handle(ws, message, this.registry);
  }
}
