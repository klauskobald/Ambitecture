import { Logger } from '../Logger';
import { BleBus, DiscoveredPeripheral } from './BleBus';
import { resolveNobleIdForAddress } from './bleLookup';
import { looksLikeNeewer } from './NeewerProtocol';

interface RegistryEntry {
    peripheral: DiscoveredPeripheral;
    lastSeenAt: number;
}

/** No advertisements this long → drop registry entry and reset noble handle. */
const STALE_PERIPHERAL_MS = 45_000;

export class DiscoveryService {
    private readonly bus: BleBus;
    private readonly scanRestartMs: number;
    private registry = new Map<string, RegistryEntry>();
    private listeners: Array<(p: DiscoveredPeripheral) => void> = [];
    private restartTimer: ReturnType<typeof setInterval> | null = null;
    private started = false;

    constructor(bus: BleBus, scanRestartMs: number) {
        this.bus = bus;
        this.scanRestartMs = scanRestartMs;
    }

    async start(): Promise<void> {
        if (this.started) return;
        this.started = true;
        await this.bus.start();
        Logger.info('[discovery] adapter ready, scanning');
        await this.bus.startScan((p) => this.onDiscover(p));
        this.restartTimer = setInterval(() => this.cycleScan(), this.scanRestartMs);
    }

    async stop(): Promise<void> {
        if (!this.started) return;
        this.started = false;
        if (this.restartTimer !== null) {
            clearInterval(this.restartTimer);
            this.restartTimer = null;
        }
        await this.bus.stopScan();
    }

    onDiscovered(cb: (p: DiscoveredPeripheral) => void): void {
        this.listeners.push(cb);
    }

    resolveNobleId(bluetoothAddress: string): string | undefined {
        return resolveNobleIdForAddress(bluetoothAddress, this.listKnown());
    }

    listKnown(): DiscoveredPeripheral[] {
        return [...this.registry.values()].map((e) => e.peripheral);
    }

    private onDiscover(p: DiscoveredPeripheral): void {
        if (!looksLikeNeewer(p.name)) return;

        const now = Date.now();
        const existing = this.registry.get(p.id);
        const isNew = !existing;
        const reappeared = existing !== undefined && now - existing.lastSeenAt > STALE_PERIPHERAL_MS;
        this.registry.set(p.id, { peripheral: p, lastSeenAt: now });

        if (isNew) {
            const addr = p.address ?? p.id;
            Logger.info(`[discovery] found ${p.name} address=${addr} rssi=${p.rssi}`);
            for (const cb of this.listeners) cb(p);
            return;
        }
        if (reappeared) {
            const addr = p.address ?? p.id;
            Logger.info(`[discovery] back in range ${p.name} address=${addr} rssi=${p.rssi}`);
            for (const cb of this.listeners) cb(p);
        }
    }

    private pruneStale(): void {
        const now = Date.now();
        for (const [id, entry] of this.registry) {
            if (now - entry.lastSeenAt <= STALE_PERIPHERAL_MS) continue;
            this.registry.delete(id);
            void this.bus.resetPeripheral(id);
            const name = entry.peripheral.name ?? id;
            Logger.info(`[discovery] dropped stale ${name}`);
        }
    }

    private async cycleScan(): Promise<void> {
        if (!this.started) return;
        this.pruneStale();
        try {
            await this.bus.stopScan();
            await this.bus.startScan((p) => this.onDiscover(p));
            // Logger.debug('[discovery] scan cycled');
        } catch (err) {
            Logger.warn('[discovery] failed to cycle scan', err);
        }
    }
}
