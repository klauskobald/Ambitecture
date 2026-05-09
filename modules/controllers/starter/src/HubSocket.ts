import WebSocket from 'ws';
import { ControllerConfig } from './Config';
import { GraphCommand, RuntimeCommand, WsEnvelope, WsMessage } from './GraphProtocol';
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
    private readonly config: ControllerConfig,
    private readonly handlers: HubSocketHandlers,
    private readonly logger: Logger,
  ) {}

  connect(): void {
    this.stopped = false;
    this.attemptConnect();
  }

  disconnect(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
  }

  /** Authoritative graph mutation. Hub returns `graph:delta` on success. */
  sendGraphCommand(command: GraphCommand): boolean {
    return this.sendMessage('graph:command', command);
  }

  /**
   * Transient live update (intent drag, sensor stream, etc.). Bypasses the
   * project-graph mutation path so high-rate streams do not block scene
   * activation, saves, or other authoritative work.
   */
  sendRuntimeCommand(command: RuntimeCommand): boolean {
    return this.sendMessage('runtime:command', command);
  }

  /**
   * Fire a named action by GUID. The hub's ActionHandler resolves execute
   * items into scene activation, intent runtime updates, or animation control.
   * Optional `args` are merged on top of intent execute patches.
   */
  sendActionTrigger(actionGuid: string, args?: Record<string, unknown>): boolean {
    return this.sendMessage('action:trigger', args ? { actionGuid, args } : { actionGuid });
  }

  /** Subscribe to a hub-owned binding key. Hub will push current value + future changes as `binding:value`. */
  sendBindingSubscribe(key: string): boolean {
    return this.sendMessage('binding:subscribe', { key });
  }

  /** Push a new value to a hub-owned binding key (e.g., animation timescale). */
  sendBindingSet(key: string, value: unknown): boolean {
    return this.sendMessage('binding:set', { key, value });
  }

  /** Toggle hub-side live keyframe edit mode for an animation. */
  sendAnimationEdit(animationGuid: string, on: boolean): boolean {
    return this.sendMessage('animation:edit', { animationGuid, on });
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
    });
    if (ok) {
      this.handlers.onRegistered();
    }
  }
}
