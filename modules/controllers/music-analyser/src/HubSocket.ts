import WebSocket from 'ws';
import { MusicAnalyserConfig } from './Config';
import { PulseSyncPayload, WsEnvelope, WsMessage } from './GraphProtocol';
import { Logger } from './Logger';

const CONNECT_TIMEOUT_MS = 5_000;
const RECONNECT_DELAY_MS = 1_000;

export interface HubSocketHandlers {
  onConnected: () => void;
  onRegistered: () => void;
  onMessage: (message: WsMessage) => void;
  onDisconnected: () => void;
  onError: (error: Error) => void;
}

function toWsUrl(hubUrl: string): string {
  if (/^wss?:\/\//i.test(hubUrl)) {
    return hubUrl;
  }
  return hubUrl.replace(/^http/i, 'ws');
}

function decodeMessage(data: WebSocket.RawData): WsMessage | null {
  const text = typeof data === 'string' ? data : data.toString();
  const parsed = JSON.parse(text) as Partial<WsEnvelope>;
  const message = parsed.message;
  if (!message || typeof message.type !== 'string') {
    return null;
  }
  return message;
}

export class HubSocket {
  private ws: WebSocket | null = null;
  private stopped = false;

  constructor(
    private readonly config: MusicAnalyserConfig,
    private readonly handlers: HubSocketHandlers,
    private readonly logger: Logger,
  ) { }

  connect(): void {
    this.stopped = false;
    this.attemptConnect();
  }

  disconnect(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
  }

  sendPulseSync(payload: PulseSyncPayload): boolean {
    return this.sendMessage('pulse:sync', payload);
  }

  sendMessage(type: string, payload: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.ws.send(JSON.stringify({
      message: {
        type,
        location: this.config.location,
        payload,
      },
    }));
    return true;
  }

  private attemptConnect(): void {
    if (this.stopped) {
      return;
    }

    const wsUrl = toWsUrl(this.config.hubUrl);
    this.logger.info(`connecting to ${wsUrl}`);
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    const connectTimer = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        this.logger.warn(`connection timed out after ${CONNECT_TIMEOUT_MS}ms`);
        ws.terminate();
      }
    }, CONNECT_TIMEOUT_MS);

    ws.on('open', () => {
      clearTimeout(connectTimer);
      this.handlers.onConnected();
      this.register();
    });

    ws.on('message', data => {
      try {
        const message = decodeMessage(data);
        if (message) {
          this.handlers.onMessage(message);
        }
      } catch (error) {
        this.handlers.onError(error instanceof Error ? error : new Error(String(error)));
      }
    });

    ws.on('close', () => {
      clearTimeout(connectTimer);
      this.handlers.onDisconnected();
      if (!this.stopped) {
        setTimeout(() => this.attemptConnect(), RECONNECT_DELAY_MS);
      }
    });

    ws.on('error', error => {
      clearTimeout(connectTimer);
      this.handlers.onError(error);
    });
  }

  private register(): void {
    const ok = this.sendMessage('register', {
      role: 'controller',
      guid: this.config.guid,
      scope: [],
      subscribe: { runtime: false },
    });
    if (ok) {
      this.handlers.onRegistered();
    }
  }
}
