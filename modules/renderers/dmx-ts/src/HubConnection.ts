import WebSocket from 'ws';
import { Logger } from './Logger';
import { Config } from './Config';
import { DmxUniverse } from './DmxUniverse';
import { ConfigHandler } from './handlers/ConfigHandler';
import { EventsHandler } from './handlers/EventsHandler';

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

/** Max wait for TCP + WebSocket handshake; avoids hanging on unreachable hub. */
const CONNECT_TIMEOUT_MS = 5000;

export class HubConnection {
    private ws: WebSocket | null = null;
    private connectGeneration = 0;
    private connectTimeout: ReturnType<typeof setTimeout> | null = null;
    private handlers: Map<string, MessageHandler>;
    private dmxUniverse: DmxUniverse;

    constructor() {
        this.dmxUniverse = new DmxUniverse();
        const configHandler = new ConfigHandler(this.dmxUniverse);
        const eventsHandler = new EventsHandler(configHandler, this.dmxUniverse);
        configHandler.setOnConfigApplied(() => eventsHandler.reapplyCurrentIntents());

        this.handlers = new Map<string, MessageHandler>([
            ['config', configHandler],
            ['events', eventsHandler],
        ]);
    }

    private clearConnectTimeout(): void {
        if (this.connectTimeout !== null) {
            clearTimeout(this.connectTimeout);
            this.connectTimeout = null;
        }
    }

    connect(): void {
        this.clearConnectTimeout();
        const gen = ++this.connectGeneration;
        const url = Config.hubWsUrl;
        Logger.info(`[ws] connecting to ${url}`);

        const ws = new WebSocket(url);
        this.ws = ws;

        this.connectTimeout = setTimeout(() => {
            this.connectTimeout = null;
            if (gen !== this.connectGeneration) {
                return;
            }
            if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
                Logger.warn(`[ws] connect timeout after ${CONNECT_TIMEOUT_MS}ms, retrying`);
                ws.terminate();
            }
        }, CONNECT_TIMEOUT_MS);

        ws.on('open', () => {
            if (gen !== this.connectGeneration) {
                return;
            }
            this.clearConnectTimeout();
            Logger.info('[ws] connected');
            this.sendRegister(ws);
        });

        ws.on('message', (data: WebSocket.RawData) => {
            this.handleRawMessage(ws, data.toString());
        });

        ws.on('close', () => {
            if (gen === this.connectGeneration) {
                this.clearConnectTimeout();
            }
            if (gen !== this.connectGeneration) {
                return;
            }
            Logger.warn('[ws] connection closed, reconnecting');
            setImmediate(() => this.connect());
        });

        ws.on('error', (err: Error) => {
            if (gen === this.connectGeneration) {
                this.clearConnectTimeout();
            }
            Logger.warn('[ws] error, reconnecting', err.message);
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
                    boundingBox: Config.boundingBox,
                },
            },
        };
        ws.send(JSON.stringify(msg));
        Logger.info(`[register] sent as renderer ${Config.guid}`);
    }
}
