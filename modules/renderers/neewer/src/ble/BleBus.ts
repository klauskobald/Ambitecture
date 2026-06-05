export interface DiscoveredPeripheral {
    id: string;
    address: string | undefined;
    name: string | undefined;
    rssi: number;
}

export interface BleConnection {
    readonly id: string;
    readonly state: 'connected' | 'disconnecting' | 'disconnected';
    writeAsync(charUuid: string, data: Buffer, withoutResponse?: boolean): Promise<void>;
    subscribeAsync(charUuid: string, onData: (data: Buffer) => void): Promise<void>;
    disconnectAsync(): Promise<void>;
    onDisconnect(cb: () => void): void;
}

export interface BleBus {
    start(): Promise<void>;
    startScan(onDiscover: (p: DiscoveredPeripheral) => void): Promise<void>;
    stopScan(): Promise<void>;
    connect(id: string, serviceUuid: string, charUuids: string[]): Promise<BleConnection>;
    resetPeripheral(id: string): Promise<void>;
    stop(): Promise<void>;
}
