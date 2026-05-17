import { createBeatEngine } from './beatEngine';
import type { BeatSyncEvent } from './beatEngine';
import { MusicAnalyserConfig } from './Config';
import { GraphInitPayload, PulseSyncPayload, WsMessage } from './GraphProtocol';
import { HubSocket } from './HubSocket';
import { Logger } from './Logger';

type PendingSync = PulseSyncPayload;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseTransmitMinIntervalSeconds(
  config: MusicAnalyserConfig,
  payload: unknown,
): number {
  if (isRecord(payload) && isRecord(payload['transmit'])) {
    const raw = payload['transmit']['minIntervalSeconds'];
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return raw;
    }
  }
  return config.transmitMinIntervalSeconds;
}

export class MusicAnalyserController {
  private readonly socket: HubSocket;
  private minIntervalMs: number;
  private lastSentAtMs = 0;
  private pendingBar: PendingSync | null = null;
  private pendingOnset: PendingSync | null = null;
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private beatEngine: { start: () => void; stop: () => void } | null = null;

  constructor(
    private readonly config: MusicAnalyserConfig,
    private readonly logger: Logger,
  ) {
    this.minIntervalMs = config.transmitMinIntervalSeconds * 1000;
    this.socket = new HubSocket(config, {
      onConnected: () => this.onConnected(),
      onRegistered: () => this.onRegistered(),
      onMessage: message => this.dispatch(message),
      onDisconnected: () => this.onDisconnected(),
      onError: error => this.onError(error),
    }, logger);
  }

  start(): void {
    this.logger.info(`starting "${this.config.name}" (${this.config.guid})`);
    this.flushTimer = setInterval(() => this.tryFlushPending(), 200);
    this.socket.connect();
  }

  stop(): void {
    if (this.flushTimer !== undefined) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.beatEngine?.stop();
    this.beatEngine = null;
    this.socket.disconnect();
    this.logger.info('stopped');
  }

  private onConnected(): void {
    this.logger.info('connected to hub');
  }

  private onRegistered(): void {
    this.logger.info('registered; waiting for graph:init');
  }

  private onGraphInit(payload: unknown): void {
    this.minIntervalMs = parseTransmitMinIntervalSeconds(this.config, payload) * 1000;
    this.logger.info(`transmit min interval ${this.minIntervalMs}ms`);
    this.startBeatEngine();
  }

  private onDisconnected(): void {
    this.logger.warn('disconnected; reconnecting');
    this.beatEngine?.stop();
    this.beatEngine = null;
  }

  private onError(error: Error): void {
    this.logger.error('socket error', error);
  }

  private dispatch(message: WsMessage): void {
    switch (message.type) {
      case 'graph:init':
        this.onGraphInit(message.payload);
        break;
      default:
        break;
    }
  }

  private startBeatEngine(): void {
    if (this.beatEngine) {
      return;
    }
    this.beatEngine = createBeatEngine({
      onSync: event => this.onBeatSync(event),
      onError: err => this.logger.error('beat engine error', err),
    });
    this.beatEngine.start();
    this.logger.info('beat engine listening');
  }

  private onBeatSync(event: BeatSyncEvent): void {
    const payload: PendingSync = {
      bpm: event.bpm,
      beatAtMs: event.t,
      sentAtMs: 0,
      kind: event.reason === 'bar' ? 'bar' : 'onset',
      phaseAdjustMs: event.phaseAdjustMs,
      audioT: event.audioT,
    };
    if (payload.kind === 'bar') {
      this.pendingBar = payload;
    } else {
      this.pendingOnset = payload;
    }
    this.tryFlushPending();
  }

  private tryFlushPending(): void {
    const pending = this.pendingBar ?? this.pendingOnset;
    if (!pending) {
      return;
    }
    const now = Date.now();
    if (now - this.lastSentAtMs < this.minIntervalMs) {
      return;
    }
    pending.sentAtMs = now;
    const ok = this.socket.sendPulseSync(pending);
    if (!ok) {
      this.logger.warn('pulse:sync send failed (socket not open)');
      return;
    }
    this.logger.info(
      `pulse:sync kind=${pending.kind} bpm=${pending.bpm} beatAt=${pending.beatAtMs}`,
    );
    this.lastSentAtMs = now;
    if (pending.kind === 'bar') {
      this.pendingBar = null;
    } else {
      this.pendingOnset = null;
    }
  }
}
