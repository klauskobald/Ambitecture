import type { DiscoveredPeripheral } from './BleBus';

const MAC_HEX_LEN = 12;

/** How a project fixture identifies its physical lamp. `id` is used on macOS, `address` on Linux. */
export interface BleMatch {
    /** BLE MAC — Linux/bluez exposes `peripheral.address` as the MAC. macOS does not. */
    address?: string;
    /** Exact noble `peripheral.id` — the only stable identifier on macOS (a CoreBluetooth UUID). */
    id?: string;
}

export function normalizeBleAddress(address: string): string {
    return address.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
}

function isBleMacNorm(norm: string): boolean {
    return norm.length === MAC_HEX_LEN;
}

/**
 * Match a discovered peripheral to a fixture by exact noble `id` or BLE MAC. Both can live in the
 * config (`params.bluetoothId` + `params.bluetoothAddress`); the renderer matches whichever the OS
 * provides — `id` on macOS (no MAC exposed), the MAC on Linux/Raspberry. Advertised name is never
 * used for matching (lamps can share a name).
 */
export function peripheralMatches(peripheral: DiscoveredPeripheral, match: BleMatch): boolean {
    if (match.id && peripheral.id === match.id) {
        return true;
    }
    const norm = match.address ? normalizeBleAddress(match.address) : '';
    if (isBleMacNorm(norm)) {
        if (peripheral.address !== undefined && normalizeBleAddress(peripheral.address) === norm) {
            return true;
        }
        const idNorm = normalizeBleAddress(peripheral.id);
        if (isBleMacNorm(idNorm) && idNorm === norm) {
            return true;
        }
    }
    return false;
}

export function findNobleId(match: BleMatch, peripherals: Iterable<DiscoveredPeripheral>): string | undefined {
    for (const p of peripherals) {
        if (peripheralMatches(p, match)) return p.id;
    }
    return undefined;
}

export function bleMatchEqual(a: BleMatch, b: BleMatch): boolean {
    const addressA = a.address ? normalizeBleAddress(a.address) : '';
    const addressB = b.address ? normalizeBleAddress(b.address) : '';
    return a.id === b.id && addressA === addressB;
}
