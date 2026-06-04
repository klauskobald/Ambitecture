import { Logger } from './Logger';
import { BleBus, BleConnection, DiscoveredPeripheral } from './ble/BleBus';
import { peripheralMatchesAddress } from './ble/bleLookup';
import { DiscoveryService } from './ble/DiscoveryService';
import { SERVICE_UUID, WRITE_UUID, NOTIFY_UUID } from './ble/NeewerProtocol';
import type { ConfiguredFixture } from './handlers/ConfigHandler';

interface FixtureBinding {
    fixture: ConfiguredFixture;
    bluetoothAddress: string;
    connection: BleConnection | null;
    connecting: boolean;
    nextRetryAt: number;
    backoffMs: number;
    lastSentHex: string | null;
    lastSentAt: number;
    offlineLogged: boolean;
}

export interface NeewerBusOptions {
    connectRetryInitialMs: number;
    connectRetryMaxMs: number;
    writeMinIntervalMs: number;
}

export class NeewerBus {
    private readonly bus: BleBus;
    private readonly discovery: DiscoveryService;
    private readonly options: NeewerBusOptions;
    private readonly bindings = new Map<string, FixtureBinding>();

    constructor(bus: BleBus, discovery: DiscoveryService, options: NeewerBusOptions) {
        this.bus = bus;
        this.discovery = discovery;
        this.options = options;
        this.discovery.onDiscovered((p) => this.onPeripheralSeen(p));
    }

    registerFixture(fixture: ConfiguredFixture, bluetoothAddress: string): void {
        const key = this.bindingKey(fixture);
        const existing = this.bindings.get(key);
        if (existing) {
            existing.fixture = fixture;
            existing.bluetoothAddress = bluetoothAddress;
            return;
        }
        this.bindings.set(key, {
            fixture,
            bluetoothAddress,
            connection: null,
            connecting: false,
            nextRetryAt: 0,
            backoffMs: this.options.connectRetryInitialMs,
            lastSentHex: null,
            lastSentAt: 0,
            offlineLogged: false,
        });

        if (this.discovery.resolveNobleId(bluetoothAddress) !== undefined) {
            void this.tryConnect(key);
        }
    }

    clearFixtures(): void {
        for (const binding of this.bindings.values()) {
            if (binding.connection) {
                void binding.connection.disconnectAsync().catch(() => undefined);
            }
        }
        this.bindings.clear();
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
            if (binding.nextRetryAt <= Date.now() && !binding.connecting && this.discovery.resolveNobleId(binding.bluetoothAddress) !== undefined) {
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

    private onPeripheralSeen(peripheral: DiscoveredPeripheral): void {
        for (const [key, binding] of this.bindings) {
            if (
                peripheralMatchesAddress(peripheral, binding.bluetoothAddress) &&
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

        const nobleId = this.discovery.resolveNobleId(binding.bluetoothAddress);
        if (nobleId === undefined) return;

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
            Logger.info(`[neewer] connected "${binding.fixture.name}"`);
        } catch (err) {
            const next = Math.min(binding.backoffMs * 2, this.options.connectRetryMaxMs);
            binding.nextRetryAt = Date.now() + binding.backoffMs;
            Logger.warn(`[neewer] connect failed for "${binding.fixture.name}" — retry in ${binding.backoffMs}ms`, err);
            binding.backoffMs = next;
        } finally {
            binding.connecting = false;
        }
    }

    private onDisconnected(key: string): void {
        const binding = this.bindings.get(key);
        if (!binding) return;
        Logger.warn(`[neewer] "${binding.fixture.name}" disconnected`);
        binding.connection = null;
        binding.nextRetryAt = Date.now() + this.options.connectRetryInitialMs;
        binding.backoffMs = this.options.connectRetryInitialMs;
        binding.lastSentHex = null;
    }

    private bindingKey(fixture: ConfiguredFixture): string {
        return fixture.name;
    }
}
