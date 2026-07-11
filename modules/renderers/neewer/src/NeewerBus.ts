import { Logger } from './Logger';
import { BleBus, BleConnection, DiscoveredPeripheral } from './ble/BleBus';
import { peripheralMatches, bleMatchEqual, type BleMatch } from './ble/bleLookup';
import { DiscoveryService } from './ble/DiscoveryService';
import { SERVICE_UUID, WRITE_UUID, NOTIFY_UUID, hsv } from './ble/NeewerProtocol';
import type { ConfiguredFixture } from './handlers/ConfigHandler';
import {
    computeChaseStep,
    hsvWithinDeadband,
    type HsvColor,
    type HsvDeadband,
} from './lerpHsv';

interface FixtureBinding {
    fixture: ConfiguredFixture;
    /** How to find this lamp: exact noble id (macOS), BLE MAC (Linux), and/or advertised name. */
    match: BleMatch;
    connection: BleConnection | null;
    connecting: boolean;
    nextRetryAt: number;
    backoffMs: number;
    lastSentHex: string | null;
    lastSentAt: number;
    offlineLogged: boolean;
    desiredHsv: HsvColor | null;
    lastSentHsv: HsvColor | null;
    frameTimer: ReturnType<typeof setTimeout> | null;
}

export interface NeewerBusOptions {
    connectRetryInitialMs: number;
    connectRetryMaxMs: number;
    connectTimeoutMs: number;
    writeMinIntervalMs: number;
    lerpFrames: number;
    deadband: HsvDeadband;
}

export interface SetHsvOptions {
    immediate?: boolean;
}

export class NeewerBus {
    private readonly bus: BleBus;
    private readonly discovery: DiscoveryService;
    private readonly options: NeewerBusOptions;
    private readonly bindings = new Map<string, FixtureBinding>();
    private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(bus: BleBus, discovery: DiscoveryService, options: NeewerBusOptions) {
        this.bus = bus;
        this.discovery = discovery;
        this.options = options;
        this.discovery.onDiscovered((p) => this.onPeripheralSeen(p));
    }

    registerFixture(fixture: ConfiguredFixture, match: BleMatch): void {
        const key = this.bindingKey(fixture);
        const existing = this.bindings.get(key);
        if (existing) {
            const matchChanged = !bleMatchEqual(existing.match, match);
            existing.fixture = fixture;
            existing.match = match;
            if (matchChanged) {
                void this.rebind(key);
            }
            return;
        }
        this.bindings.set(key, {
            fixture,
            match,
            connection: null,
            connecting: false,
            nextRetryAt: 0,
            backoffMs: this.options.connectRetryInitialMs,
            lastSentHex: null,
            lastSentAt: 0,
            offlineLogged: false,
            desiredHsv: null,
            lastSentHsv: null,
            frameTimer: null,
        });

        if (this.discovery.resolveNobleId(match) !== undefined) {
            void this.tryConnect(key);
        }
    }

    syncFixtures(entries: Array<{ fixture: ConfiguredFixture; match: BleMatch }>): void {
        const nextKeys = new Set(entries.map((entry) => this.bindingKey(entry.fixture)));
        for (const key of [...this.bindings.keys()]) {
            if (!nextKeys.has(key)) {
                this.removeBinding(key);
            }
        }
        for (const entry of entries) {
            this.registerFixture(entry.fixture, entry.match);
        }
    }

    private removeBinding(key: string): void {
        const binding = this.bindings.get(key);
        if (!binding) return;
        this.clearReconnectTimer(key);
        this.clearColorState(binding);
        const nobleId = binding.connection?.id;
        if (binding.connection) {
            const connection = binding.connection;
            binding.connection = null;
            if (nobleId !== undefined) {
                this.discovery.markDisconnected(nobleId);
                void connection.disconnectAsync().catch(() => undefined);
                void this.bus.resetPeripheral(nobleId);
            }
        }
        this.bindings.delete(key);
    }

    private async rebind(key: string): Promise<void> {
        const binding = this.bindings.get(key);
        if (!binding) return;
        this.clearReconnectTimer(key);
        this.clearColorState(binding);
        const nobleId = binding.connection?.id;
        if (binding.connection) {
            const connection = binding.connection;
            binding.connection = null;
            if (nobleId !== undefined) {
                this.discovery.markDisconnected(nobleId);
            }
            try {
                await connection.disconnectAsync();
            } catch {
                // link may already be dead
            }
            if (nobleId !== undefined) {
                await this.bus.resetPeripheral(nobleId);
            }
        }
        binding.connecting = false;
        binding.nextRetryAt = 0;
        binding.backoffMs = this.options.connectRetryInitialMs;
        binding.lastSentHex = null;
        binding.offlineLogged = false;
        if (this.discovery.resolveNobleId(binding.match) !== undefined) {
            void this.tryConnect(key);
        }
    }

    clearFixtures(): void {
        for (const [key, binding] of this.bindings) {
            this.clearReconnectTimer(key);
            this.clearColorState(binding);
            if (binding.connection) {
                void binding.connection.disconnectAsync().catch(() => undefined);
            }
        }
        this.bindings.clear();
    }

    setHsv(fixture: ConfiguredFixture, h: number, s: number, v: number, options?: SetHsvOptions): void {
        const key = this.bindingKey(fixture);
        const binding = this.bindings.get(key);
        if (!binding) return;

        binding.desiredHsv = { h, s, v };

        const bypassChase = options?.immediate === true || this.options.lerpFrames <= 0;
        const bypassThrottle = options?.immediate === true;
        if (bypassChase) {
            if (bypassThrottle && binding.frameTimer !== null) {
                clearTimeout(binding.frameTimer);
                binding.frameTimer = null;
            }
            void this.trySendColor(key, bypassThrottle);
            return;
        }

        if (
            binding.lastSentHsv !== null &&
            hsvWithinDeadband(binding.lastSentHsv, binding.desiredHsv, this.options.deadband)
        ) {
            return;
        }

        void this.trySendColor(key);
    }

    async send(fixture: ConfiguredFixture, packet: Buffer): Promise<void> {
        const key = this.bindingKey(fixture);
        const binding = this.bindings.get(key);
        if (!binding) return;

        if (!binding.connection || binding.connection.state !== 'connected') {
            if (!binding.connecting && !binding.offlineLogged) {
                Logger.warn(`[neewer] "${fixture.name}" is offline — dropping writes until reconnect`);
                binding.offlineLogged = true;
            }
            if (binding.nextRetryAt <= Date.now() && !binding.connecting && this.discovery.resolveNobleId(binding.match) !== undefined) {
                void this.tryConnect(key);
            }
            return;
        }

        const now = Date.now();
        if (now - binding.lastSentAt < this.options.writeMinIntervalMs) return;
        const hex = packet.toString('hex');
        if (hex === binding.lastSentHex) return;

        try {
            await binding.connection.writeAsync(WRITE_UUID, packet, true);
            binding.lastSentHex = hex;
            binding.lastSentAt = now;
        } catch (err) {
            Logger.warn(`[neewer] write failed on "${fixture.name}"`, err);
            this.dropConnectionAfterWriteFailure(key);
        }
    }

    private async trySendColor(key: string, bypassThrottle = false): Promise<void> {
        const binding = this.bindings.get(key);
        if (!binding || binding.desiredHsv === null) return;

        const fixture = binding.fixture;
        if (!binding.connection || binding.connection.state !== 'connected') {
            if (!binding.connecting && !binding.offlineLogged) {
                Logger.warn(`[neewer] "${fixture.name}" is offline — dropping writes until reconnect`);
                binding.offlineLogged = true;
            }
            if (binding.nextRetryAt <= Date.now() && !binding.connecting && this.discovery.resolveNobleId(binding.match) !== undefined) {
                void this.tryConnect(key);
            }
            return;
        }

        const desired = binding.desiredHsv;
        const now = Date.now();
        const elapsed = now - binding.lastSentAt;
        if (!bypassThrottle && elapsed < this.options.writeMinIntervalMs) {
            if (binding.frameTimer === null) {
                const delay = this.options.writeMinIntervalMs - elapsed;
                binding.frameTimer = setTimeout(() => {
                    binding.frameTimer = null;
                    void this.trySendColor(key);
                }, delay);
            }
            return;
        }

        let colorToSend: HsvColor;
        let continueChase = false;

        if (bypassThrottle || this.options.lerpFrames <= 0) {
            colorToSend = desired;
        } else if (binding.lastSentHsv === null) {
            colorToSend = desired;
        } else {
            const chase = computeChaseStep(
                binding.lastSentHsv,
                desired,
                this.options.lerpFrames,
                this.options.deadband,
            );

            if (chase.arrived) {
                if (chase.colorToSend !== null) {
                    await this.writeHsvColor(binding, chase.colorToSend, now);
                } else {
                    binding.lastSentHsv = { ...desired };
                }
                return;
            }

            if (chase.colorToSend === null) {
                if (chase.continueChase) {
                    this.scheduleNextColorFrame(key, binding);
                }
                return;
            }

            colorToSend = chase.colorToSend;
            continueChase = chase.continueChase;
        }

        if (
            binding.lastSentHsv !== null &&
            hsvWithinDeadband(binding.lastSentHsv, colorToSend, this.options.deadband) &&
            hsvWithinDeadband(binding.lastSentHsv, desired, this.options.deadband)
        ) {
            binding.lastSentHsv = { ...desired };
            return;
        }

        const sent = await this.writeHsvColor(binding, colorToSend, now);
        if (sent && continueChase) {
            this.scheduleNextColorFrame(key, binding);
        } else if (sent && binding.lastSentHsv !== null && !hsvWithinDeadband(binding.lastSentHsv, desired, this.options.deadband)) {
            this.scheduleNextColorFrame(key, binding);
        }
    }

    private async writeHsvColor(
        binding: FixtureBinding,
        colorToSend: HsvColor,
        now: number,
    ): Promise<boolean> {
        const fixture = binding.fixture;
        const packet = hsv(colorToSend.h, colorToSend.s, colorToSend.v);
        const hex = packet.toString('hex');
        if (hex === binding.lastSentHex) {
            binding.lastSentHsv = { ...colorToSend };
            return true;
        }

        if (!binding.connection || binding.connection.state !== 'connected') {
            return false;
        }

        try {
            await binding.connection.writeAsync(WRITE_UUID, packet, true);
            binding.lastSentHex = hex;
            binding.lastSentAt = now;
            binding.lastSentHsv = { ...colorToSend };
            return true;
        } catch (err) {
            Logger.warn(`[neewer] write failed on "${fixture.name}"`, err);
            this.dropConnectionAfterWriteFailure(this.bindingKey(fixture));
            return false;
        }
    }

    private scheduleNextColorFrame(key: string, binding: FixtureBinding): void {
        if (binding.frameTimer !== null) return;
        binding.frameTimer = setTimeout(() => {
            binding.frameTimer = null;
            void this.trySendColor(key);
        }, this.options.writeMinIntervalMs);
    }

    private clearColorState(binding: FixtureBinding): void {
        if (binding.frameTimer !== null) {
            clearTimeout(binding.frameTimer);
            binding.frameTimer = null;
        }
        binding.desiredHsv = null;
        binding.lastSentHsv = null;
    }

    private onPeripheralSeen(peripheral: DiscoveredPeripheral): void {
        for (const [key, binding] of this.bindings) {
            if (
                peripheralMatches(peripheral, binding.match) &&
                !binding.connection &&
                !binding.connecting
            ) {
                void this.tryConnect(key);
            }
        }
    }

    private async tryConnect(key: string): Promise<void> {
        const binding = this.bindings.get(key);
        if (!binding || binding.connecting || binding.connection) return;
        if (Date.now() < binding.nextRetryAt) return;

        const nobleId = this.discovery.resolveNobleId(binding.match);
        if (nobleId === undefined) {
            binding.nextRetryAt = Date.now() + this.options.connectRetryInitialMs;
            this.scheduleReconnect(key);
            return;
        }

        binding.connecting = true;
        Logger.info(`[neewer] connecting "${binding.fixture.name}" id=${nobleId}`);
        try {
            const connection = await this.connectWithTimeout(nobleId);
            connection.onDisconnect(() => this.onDisconnected(key));
            try {
                await connection.subscribeAsync(NOTIFY_UUID, (data) => {
                    Logger.debug(`[neewer] "${binding.fixture.name}" notify <- ${data.toString('hex')}`);
                });
            } catch {
                // some firmwares lack notify; non-fatal
            }
            binding.connection = connection;
            binding.backoffMs = this.options.connectRetryInitialMs;
            binding.offlineLogged = false;
            this.discovery.markConnected(nobleId);
            this.clearReconnectTimer(key);
            Logger.info(`[neewer] connected "${binding.fixture.name}"`);
            void this.trySendColor(key);
        } catch (err) {
            const next = Math.min(binding.backoffMs * 2, this.options.connectRetryMaxMs);
            binding.nextRetryAt = Date.now() + binding.backoffMs;
            Logger.warn(`[neewer] connect failed for "${binding.fixture.name}" — retry in ${binding.backoffMs}ms`, err);
            binding.backoffMs = next;
            await this.bus.resetPeripheral(nobleId);
            this.scheduleReconnect(key);
        } finally {
            binding.connecting = false;
        }
    }

    private connectWithTimeout(nobleId: string): Promise<BleConnection> {
        const timeoutMs = this.options.connectTimeoutMs;
        return new Promise<BleConnection>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`connect timeout after ${timeoutMs}ms`));
            }, timeoutMs);
            void this.bus
                .connect(nobleId, SERVICE_UUID, [WRITE_UUID, NOTIFY_UUID])
                .then((connection) => {
                    clearTimeout(timer);
                    resolve(connection);
                })
                .catch((err: unknown) => {
                    clearTimeout(timer);
                    reject(err);
                });
        });
    }

    private dropConnectionAfterWriteFailure(key: string): void {
        const binding = this.bindings.get(key);
        if (!binding?.connection) return;
        const connection = binding.connection;
        const nobleId = connection.id;
        binding.connection = null;
        void connection.disconnectAsync().catch(() => undefined);
        this.beginReconnect(key, nobleId, 'write failed — reconnecting');
    }

    private onDisconnected(key: string): void {
        const binding = this.bindings.get(key);
        if (!binding?.connection) return;
        const nobleId = binding.connection.id;
        this.beginReconnect(key, nobleId, 'disconnected');
    }

    private beginReconnect(key: string, nobleId: string, reason: string): void {
        const binding = this.bindings.get(key);
        if (!binding) return;
        Logger.warn(`[neewer] "${binding.fixture.name}" ${reason}`);
        binding.connection = null;
        binding.connecting = false;
        binding.nextRetryAt = Date.now() + this.options.connectRetryInitialMs;
        binding.backoffMs = this.options.connectRetryInitialMs;
        binding.lastSentHex = null;
        this.clearColorState(binding);
        this.discovery.markDisconnected(nobleId);
        void this.bus.resetPeripheral(nobleId);
        this.scheduleReconnect(key);
    }

    private clearReconnectTimer(key: string): void {
        const timer = this.reconnectTimers.get(key);
        if (timer === undefined) return;
        clearTimeout(timer);
        this.reconnectTimers.delete(key);
    }

    private scheduleReconnect(key: string): void {
        const binding = this.bindings.get(key);
        if (!binding || binding.connection || binding.connecting) return;

        this.clearReconnectTimer(key);
        const delay = Math.max(0, binding.nextRetryAt - Date.now());
        const timer = setTimeout(() => {
            this.reconnectTimers.delete(key);
            void this.tryConnect(key);
        }, delay);
        this.reconnectTimers.set(key, timer);
    }

    private bindingKey(fixture: ConfiguredFixture): string {
        return fixture.name;
    }
}
