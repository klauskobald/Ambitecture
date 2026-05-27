import noble from '@stoprocent/noble';
import type { Peripheral, Characteristic } from '@stoprocent/noble';
import { Logger } from '../Logger';
import { BleBus, BleConnection, DiscoveredPeripheral } from './BleBus';

class NoblePeripheralConnection implements BleConnection {
    private readonly peripheral: Peripheral;
    private readonly characteristics: Map<string, Characteristic>;
    private disconnectCallbacks: Array<() => void> = [];

    constructor(peripheral: Peripheral, characteristics: Characteristic[]) {
        this.peripheral = peripheral;
        this.characteristics = new Map();
        for (const c of characteristics) {
            this.characteristics.set(c.uuid, c);
        }
        peripheral.once('disconnect', () => {
            for (const cb of this.disconnectCallbacks) cb();
            this.disconnectCallbacks = [];
        });
    }

    get id(): string {
        return this.peripheral.id;
    }

    get state(): 'connected' | 'disconnecting' | 'disconnected' {
        const s = this.peripheral.state;
        if (s === 'connected') return 'connected';
        if (s === 'disconnecting') return 'disconnecting';
        return 'disconnected';
    }

    async writeAsync(charUuid: string, data: Buffer, withoutResponse: boolean = true): Promise<void> {
        const char = this.characteristics.get(charUuid);
        if (!char) throw new Error(`characteristic ${charUuid} not in connection`);
        await char.writeAsync(data, withoutResponse);
    }

    async subscribeAsync(charUuid: string, onData: (data: Buffer) => void): Promise<void> {
        const char = this.characteristics.get(charUuid);
        if (!char) throw new Error(`characteristic ${charUuid} not in connection`);
        char.on('data', (data: Buffer) => onData(data));
        await char.subscribeAsync();
    }

    async disconnectAsync(): Promise<void> {
        if (this.peripheral.state === 'disconnected') return;
        await this.peripheral.disconnectAsync();
    }

    onDisconnect(cb: () => void): void {
        this.disconnectCallbacks.push(cb);
    }
}

export class NobleBleBus implements BleBus {
    private scanning = false;
    private peripheralsById = new Map<string, Peripheral>();

    async start(): Promise<void> {
        if (noble.state === 'poweredOn') return;
        await new Promise<void>((resolve, reject) => {
            const onState = (state: string): void => {
                if (state === 'poweredOn') {
                    noble.removeListener('stateChange', onState);
                    resolve();
                } else if (state === 'unauthorized' || state === 'unsupported') {
                    noble.removeListener('stateChange', onState);
                    reject(new Error(`BLE adapter state: ${state}`));
                }
            };
            noble.on('stateChange', onState);
        });
    }

    async startScan(onDiscover: (p: DiscoveredPeripheral) => void): Promise<void> {
        if (this.scanning) return;
        noble.on('discover', (peripheral: Peripheral) => {
            this.peripheralsById.set(peripheral.id, peripheral);
            const name = peripheral.advertisement?.localName;
            onDiscover({ id: peripheral.id, name, rssi: peripheral.rssi });
        });
        await noble.startScanningAsync([], true);
        this.scanning = true;
    }

    async stopScan(): Promise<void> {
        if (!this.scanning) return;
        noble.removeAllListeners('discover');
        await noble.stopScanningAsync();
        this.scanning = false;
    }

    async connect(id: string, serviceUuid: string, charUuids: string[]): Promise<BleConnection> {
        const peripheral = this.peripheralsById.get(id);
        if (!peripheral) throw new Error(`peripheral ${id} not seen by scan yet`);
        if (peripheral.state === 'connected') {
            Logger.debug(`[ble] reusing existing connection ${id}`);
        } else {
            await peripheral.connectAsync();
        }
        const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
            [serviceUuid],
            charUuids,
        );
        return new NoblePeripheralConnection(peripheral, characteristics);
    }

    async stop(): Promise<void> {
        await this.stopScan();
        for (const p of this.peripheralsById.values()) {
            if (p.state === 'connected') {
                try { await p.disconnectAsync(); } catch { /* best-effort */ }
            }
        }
        this.peripheralsById.clear();
    }
}
