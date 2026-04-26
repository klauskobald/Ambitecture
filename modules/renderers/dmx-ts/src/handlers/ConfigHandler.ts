import WebSocket from 'ws';
import { Logger } from '../Logger';

interface WsMessage {
    type: string;
    location?: [number, number];
    payload?: unknown;
}

interface MessageHandler {
    handle(ws: WebSocket, message: WsMessage): void;
}

export class ConfigHandler implements MessageHandler {
    handle(_ws: WebSocket, message: WsMessage): void {
        Logger.info('[config] received', message.payload);
    }
}
