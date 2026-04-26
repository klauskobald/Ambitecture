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

interface LightEventParams {
    color?: { x: number; y: number; Y: number };
    layer?: number;
    blend?: string;
    alpha?: number;
}

interface LightEvent {
    class: string;
    scheduled?: number;
    position?: [number, number, number];
    params?: LightEventParams;
}

export class EventsHandler implements MessageHandler {
    handle(_ws: WebSocket, message: WsMessage): void {
        const events = message.payload as LightEvent[];
        if (!Array.isArray(events)) return;
        for (const event of events) {
            Logger.info(
                `[event] class=${event.class} pos=${JSON.stringify(event.position)} color=${JSON.stringify(event.params?.color)} layer=${event.params?.layer}`
            );
        }
    }
}
