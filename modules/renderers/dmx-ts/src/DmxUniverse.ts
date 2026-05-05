import { Logger } from './Logger';
import { Config } from './Config';

type UniverseHandle = {
    update(channels: Record<number, number>): void;
    stop?: () => void;
    close?: (cb?: (err?: Error | null) => void) => void;
    on?: (event: string, listener: (err?: unknown) => void) => void;
    dev?: {
        on?: (event: string, listener: (err?: unknown) => void) => void;
        isOpen?: boolean;
    };
};
type DmxInstance = {
    addUniverse(universe: string, driver: string, deviceId?: string): UniverseHandle;
};
type DmxConstructor = new () => DmxInstance;
const DmxLib = require('dmx') as DmxConstructor;
type DmxWriteError = Error & { code?: string; disconnect?: boolean };

export class DmxUniverse {
    private universe: UniverseHandle | null = null;
    private channels: Record<number, number> = {};
    private flushTimer: ReturnType<typeof setInterval> | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private openVerifyTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly reconnectDelayMs = 2000;
    private readonly openVerifyDelayMs = 1200;
    private reconnectAttempt = 0;

    get isInitialized(): boolean {
        return this.universe !== null;
    }

    initialize(): void {
        const frameRate = Config.dmxFrameRate;

        this.tryInitializeUniverse();

        if (this.flushTimer === null) {
            this.flushTimer = setInterval(() => this.flushNow(), Math.round(1000 / frameRate));
        }
    }

    setChannel(channel: number, value: number): void {
        this.channels[channel] = Math.max(0, Math.min(255, Math.round(value)));
    }

    /** Push current channel buffer to the DMX driver (also called on the periodic refresh interval). */
    flushNow(): void {
        if (this.universe === null) {
            return;
        }

        try {
            this.universe.update({ ...this.channels });
        } catch (error) {
            this.handleWriteError(error);
        }
    }

    shutdown(): void {
        if (this.flushTimer !== null) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.openVerifyTimer !== null) {
            clearTimeout(this.openVerifyTimer);
            this.openVerifyTimer = null;
        }
        this.universe = null;
    }

    private tryInitializeUniverse(): void {
        const driver = Config.dmxDriver;
        const port = Config.dmxPort;
        const universeName = Config.dmxUniverseName;

        try {
            const dmx = new DmxLib();
            this.universe = dmx.addUniverse(universeName, driver, port);
            this.attachErrorHandlers(this.universe);
            this.verifyUniverseOpen();
            Logger.info(`[dmx] probing universe '${universeName}' on ${driver} ${port || '(no port)'}`);
        } catch (error) {
            this.universe = null;
            Logger.warn('[dmx] init failed; will retry', this.formatError(error));
            this.scheduleReconnect();
        }
    }

    private handleWriteError(error: unknown): void {
        this.enterRecoveryMode('device write failed; entering recovery mode', error);
    }

    private attachErrorHandlers(universe: UniverseHandle): void {
        universe.on?.('error', (error: unknown) => {
            this.enterRecoveryMode('driver emitted error', error);
        });
        universe.dev?.on?.('error', (error: unknown) => {
            this.enterRecoveryMode('serial device emitted error', error);
        });
        universe.dev?.on?.('close', () => {
            this.enterRecoveryMode('serial device closed', 'port closed');
        });
    }

    private enterRecoveryMode(message: string, error: unknown): void {
        if (this.universe === null) {
            return;
        }

        const dmxError = error as DmxWriteError;
        Logger.warn(`[dmx] ${message}`, this.formatError(dmxError));
        this.stopCurrentUniverse();
        this.universe = null;
        this.scheduleReconnect();
    }

    private verifyUniverseOpen(): void {
        if (this.openVerifyTimer !== null) {
            clearTimeout(this.openVerifyTimer);
        }

        this.openVerifyTimer = setTimeout(() => {
            this.openVerifyTimer = null;
            if (this.universe === null) {
                return;
            }

            const isOpen = this.universe.dev?.isOpen;
            if (typeof isOpen === 'boolean' && !isOpen) {
                this.enterRecoveryMode('serial device did not open', 'port is not open');
                return;
            }

            this.reconnectAttempt = 0;
            Logger.info('[dmx] recovery successful');
        }, this.openVerifyDelayMs);
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer !== null) {
            return;
        }

        this.reconnectAttempt++;
        Logger.warn(`[dmx] retry ${this.reconnectAttempt}: reconnecting in ${this.reconnectDelayMs}ms`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.tryInitializeUniverse();
            if (this.universe === null) {
                this.scheduleReconnect();
            }
        }, this.reconnectDelayMs);
    }

    private stopCurrentUniverse(): void {
        if (this.universe === null) {
            return;
        }

        try {
            if (this.openVerifyTimer !== null) {
                clearTimeout(this.openVerifyTimer);
                this.openVerifyTimer = null;
            }
            this.universe.stop?.();
            this.universe.close?.();
        } catch (error) {
            Logger.warn('[dmx] failed to stop previous universe cleanly', this.formatError(error));
        }
    }

    private formatError(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }
}
