import WebSocket from 'ws';

export interface WsMessage {
    type: string;
    location?: [number, number];
    payload?: unknown;
}

export interface MessageHandler {
    handle(ws: WebSocket, message: WsMessage): void;
}

export class PingHandler implements MessageHandler {
    handle(ws: WebSocket, _message: WsMessage): void {
        ws.send(JSON.stringify({ message: { type: 'pong' } }));
    }
}
