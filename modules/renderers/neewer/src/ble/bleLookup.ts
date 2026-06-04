import type { DiscoveredPeripheral } from './BleBus';

const MAC_HEX_LEN = 12;

export function normalizeBleAddress(address: string): string {
    return address.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
}

function isBleMacNorm(norm: string): boolean {
    return norm.length === MAC_HEX_LEN;
}

export function peripheralMatchesAddress(peripheral: DiscoveredPeripheral, bluetoothAddress: string): boolean {
    const norm = normalizeBleAddress(bluetoothAddress);
    if (!isBleMacNorm(norm)) return false;
    if (peripheral.address !== undefined && normalizeBleAddress(peripheral.address) === norm) {
        return true;
    }
    const idNorm = normalizeBleAddress(peripheral.id);
    return isBleMacNorm(idNorm) && idNorm === norm;
}

export function resolveNobleIdForAddress(
    bluetoothAddress: string,
    peripherals: Iterable<DiscoveredPeripheral>,
): string | undefined {
    for (const p of peripherals) {
        if (peripheralMatchesAddress(p, bluetoothAddress)) return p.id;
    }
    return undefined;
}
