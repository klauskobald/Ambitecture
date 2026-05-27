import { Logger } from '../Logger';
import { BleBus, DiscoveredPeripheral } from './BleBus';
import { looksLikeNeewer } from './NeewerProtocol';

interface RegistryEntry {
    peripheral: DiscoveredPeripheral;
    lastSeenAt: number;
}

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

    getPeripheral(id: string): DiscoveredPeripheral | undefined {
        return this.registry.get(id)?.peripheral;
    }

    listKnown(): DiscoveredPeripheral[] {
        return [...this.registry.values()].map((e) => e.peripheral);
    }

    private onDiscover(p: DiscoveredPeripheral): void {
        if (!looksLikeNeewer(p.name)) return;

        const existing = this.registry.get(p.id);
        const isNew = !existing;
        this.registry.set(p.id, { peripheral: p, lastSeenAt: Date.now() });

        if (isNew) {
            Logger.info(`[discovery] found ${p.name} id=${p.id} rssi=${p.rssi}`);
            for (const cb of this.listeners) cb(p);
        }
    }

    private async cycleScan(): Promise<void> {
        if (!this.started) return;
        try {
            await this.bus.stopScan();
            await this.bus.startScan((p) => this.onDiscover(p));
            // Logger.debug('[discovery] scan cycled');
        } catch (err) {
            Logger.warn('[discovery] failed to cycle scan', err);
        }
    }
}
