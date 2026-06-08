import assert from 'node:assert/strict';
import { peripheralMatches, findNobleId } from '../../src/ble/bleLookup';
import type { DiscoveredPeripheral } from '../../src/ble/BleBus';

// Linux/bluez: noble exposes the MAC as both `address` and (normalized) `id`.
const linuxPeripheral: DiscoveredPeripheral = {
    id: 'ca25a60d573d',
    address: 'ca:25:a6:0d:57:3d',
    name: 'NEEWER-RGB62',
    rssi: -50,
};

assert.equal(peripheralMatches(linuxPeripheral, { address: 'ca:25:a6:0d:57:3d' }), true);
assert.equal(peripheralMatches(linuxPeripheral, { address: 'ca25a60d573d' }), true);
assert.equal(peripheralMatches(linuxPeripheral, { id: 'ca25a60d573d' }), true);
assert.equal(peripheralMatches(linuxPeripheral, { address: '748242c2fd60b5bcbf82dc811f382328' }), false);
assert.equal(findNobleId({ address: 'ca:25:a6:0d:57:3d' }, [linuxPeripheral]), 'ca25a60d573d');

// macOS: no MAC exposed (`address` empty), `id` is a CoreBluetooth UUID. MAC can't match; only `id` does.
const macPeripheral: DiscoveredPeripheral = {
    id: '748242c2fd60b5bcbf82dc811f382328',
    address: '',
    name: 'NEEWER-RGB62',
    rssi: -50,
};

assert.equal(peripheralMatches(macPeripheral, { id: '748242c2fd60b5bcbf82dc811f382328' }), true);
assert.equal(peripheralMatches(macPeripheral, { address: 'ca:25:a6:0d:57:3d' }), false);
// Both keys in config (the normal case): the renderer matches whichever the OS provides — here the id.
assert.equal(
    peripheralMatches(macPeripheral, { address: 'ca:25:a6:0d:57:3d', id: '748242c2fd60b5bcbf82dc811f382328' }),
    true,
);
assert.equal(findNobleId({ address: 'ca:25:a6:0d:57:3d' }, [macPeripheral]), undefined);
assert.equal(findNobleId({ id: '748242c2fd60b5bcbf82dc811f382328' }, [macPeripheral]), '748242c2fd60b5bcbf82dc811f382328');

console.log('bleLookup.test.ts: ok');
