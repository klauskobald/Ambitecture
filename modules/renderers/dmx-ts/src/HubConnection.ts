import WebSocket from 'ws';
import { Logger } from './Logger';
import { Config } from './Config';
import { PingHandler } from './handlers/PingHandler';
import { EventsHandler } from './handlers/EventsHandler';
import { ConfigHandler } from './handlers/ConfigHandler';

interface WsMessage {
    type: string;
    location?: [number, number];
    payload?: unknown;
}

interface WsEnvelope {
    message: WsMessage;
}

interface MessageHandler {
    handle(ws: WebSocket, message: WsMessage): void;
}

const PING_INTERVAL_MS = 10_000;
const PONG_TIMEOUT_MS = 15_000;

export class HubConnection {
    private ws: WebSocket | null = null;
    private pingTimer: NodeJS.Timeout | null = null;
    private pongTimer: NodeJS.Timeout | null = null;
    private handlers: Map<string, MessageHandler>;

    constructor() {
        this.handlers = new Map<string, MessageHandler>([
            ['ping', new PingHandler()],
            ['events', new EventsHandler()],
            ['config', new ConfigHandler()],
        ]);
    }

    connect(): void {
        const url = Config.hubWsUrl;
        Logger.info(`[ws] connecting to ${url}`);

        const ws = new WebSocket(url);
        this.ws = ws;

        ws.on('open', () => {
            Logger.info('[ws] connected');
            this.sendRegister(ws);
            this.startHeartbeat(ws);
        });

        ws.on('message', (data: WebSocket.RawData) => {
            this.handleRawMessage(ws, data.toString());
        });

        ws.on('close', () => {
            Logger.warn('[ws] connection closed, reconnecting');
            this.stopHeartbeat();
            setImmediate(() => this.connect());
        });

        ws.on('error', (err: Error) => {
            Logger.warn('[ws] error, reconnecting', err.message);
            this.stopHeartbeat();
            // 'close' fires after 'error' in ws, but guard against double-reconnect
            ws.terminate();
        });
    }

    private handleRawMessage(ws: WebSocket, raw: string): void {
        let envelope: WsEnvelope;
        try {
            envelope = JSON.parse(raw) as WsEnvelope;
        } catch {
            Logger.warn('[ws] unparseable message', raw);
            return;
        }

        const message = envelope.message;
        if (!message?.type) {
            Logger.warn('[ws] message missing type', raw);
            return;
        }

        if (message.type === 'pong') {
            this.resetPongTimeout(ws);
            return;
        }

        const handler = this.handlers.get(message.type);
        if (handler) {
            handler.handle(ws, message);
        } else {
            Logger.warn(`[ws] no handler for message type: ${message.type}`);
        }
    }

    private sendRegister(ws: WebSocket): void {
        const msg: WsEnvelope = {
            message: {
                type: 'register',
                location: Config.geoLocation,
                payload: {
                    role: 'renderer',
                    guid: Config.guid,
                    positionOrigin: Config.positionOrigin,
                    boundingBox: Config.boundingBox,
                },
            },
        };
        ws.send(JSON.stringify(msg));
        Logger.info(`[register] sent as renderer ${Config.guid}`);
    }

    private startHeartbeat(ws: WebSocket): void {
        this.resetPongTimeout(ws);

        this.pingTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ message: { type: 'ping' } }));
            }
        }, PING_INTERVAL_MS);
    }

    private resetPongTimeout(ws: WebSocket): void {
        if (this.pongTimer) {
            clearTimeout(this.pongTimer);
        }
        this.pongTimer = setTimeout(() => {
            Logger.warn('[ws] pong timeout, terminating connection');
            ws.terminate();
        }, PONG_TIMEOUT_MS);
    }

    private stopHeartbeat(): void {
        if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
        if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
    }
}
