import { Logger } from './Logger';
import { BleBus, BleConnection, DiscoveredPeripheral } from './ble/BleBus';
import { peripheralMatches, type BleMatch } from './ble/bleLookup';
import { DiscoveryService } from './ble/DiscoveryService';
import { SERVICE_UUID, WRITE_UUID, NOTIFY_UUID, hsv } from './ble/NeewerProtocol';
import type { ConfiguredFixture } from './handlers/ConfigHandler';

interface HsvColor {
    h: number;
    s: number;
    v: number;
}

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
    writeMinIntervalMs: number;
}

function hsvEqual(a: HsvColor, b: HsvColor): boolean {
    return a.h === b.h && a.s === b.s && a.v === b.v;
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
            existing.fixture = fixture;
            existing.match = match;
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

    setHsv(fixture: ConfiguredFixture, h: number, s: number, v: number): void {
        const key = this.bindingKey(fixture);
        const binding = this.bindings.get(key);
        if (!binding) return;

        binding.desiredHsv = { h, s, v };
        void this.trySendColor(key);
    }

    async send(fixture: ConfiguredFixture, packet: Buffer): Promise<void> {
        const key = this.bindingKey(fixture);
        const binding = this.bindings.get(key);
        if (!binding) return;

        if (!binding.connection || binding.connection.state !== 'connected') {
            if (!binding.offlineLogged) {
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
        }
    }

    private async trySendColor(key: string): Promise<void> {
        const binding = this.bindings.get(key);
        if (!binding || binding.desiredHsv === null) return;

        const fixture = binding.fixture;
        if (!binding.connection || binding.connection.state !== 'connected') {
            if (!binding.offlineLogged) {
                Logger.warn(`[neewer] "${fixture.name}" is offline — dropping writes until reconnect`);
                binding.offlineLogged = true;
            }
            if (binding.nextRetryAt <= Date.now() && !binding.connecting && this.discovery.resolveNobleId(binding.match) !== undefined) {
                void this.tryConnect(key);
            }
            return;
        }

        const desired = binding.desiredHsv;
        if (binding.lastSentHsv !== null && hsvEqual(desired, binding.lastSentHsv)) {
            return;
        }

        const now = Date.now();
        const elapsed = now - binding.lastSentAt;
        if (elapsed < this.options.writeMinIntervalMs) {
            if (binding.frameTimer === null) {
                const delay = this.options.writeMinIntervalMs - elapsed;
                binding.frameTimer = setTimeout(() => {
                    binding.frameTimer = null;
                    void this.trySendColor(key);
                }, delay);
            }
            return;
        }

        const packet = hsv(desired.h, desired.s, desired.v);
        const hex = packet.toString('hex');
        if (hex === binding.lastSentHex) {
            binding.lastSentHsv = { ...desired };
            return;
        }

        try {
            await binding.connection.writeAsync(WRITE_UUID, packet, true);
            binding.lastSentHex = hex;
            binding.lastSentAt = now;
            binding.lastSentHsv = { ...desired };
        } catch (err) {
            Logger.warn(`[neewer] write failed on "${fixture.name}"`, err);
        }
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
            const connection = await this.bus.connect(nobleId, SERVICE_UUID, [WRITE_UUID, NOTIFY_UUID]);
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

    private onDisconnected(key: string): void {
        const binding = this.bindings.get(key);
        if (!binding) return;
        const nobleId = binding.connection?.id;
        Logger.warn(`[neewer] "${binding.fixture.name}" disconnected`);
        binding.connection = null;
        binding.nextRetryAt = Date.now() + this.options.connectRetryInitialMs;
        binding.backoffMs = this.options.connectRetryInitialMs;
        binding.lastSentHex = null;
        this.clearColorState(binding);
        if (nobleId !== undefined) {
            void this.bus.resetPeripheral(nobleId);
        }
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
