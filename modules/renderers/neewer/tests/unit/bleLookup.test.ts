import assert from 'node:assert/strict';
import { peripheralMatchesAddress, resolveNobleIdForAddress } from '../../src/ble/bleLookup';
import type { DiscoveredPeripheral } from '../../src/ble/BleBus';

const linuxPeripheral: DiscoveredPeripheral = {
    id: 'ca25a60d573d',
    address: 'ca:25:a6:0d:57:3d',
    name: 'NEEWER-RGB62',
    rssi: -50,
};

assert.equal(peripheralMatchesAddress(linuxPeripheral, 'ca:25:a6:0d:57:3d'), true);
assert.equal(peripheralMatchesAddress(linuxPeripheral, 'ca25a60d573d'), true);
assert.equal(peripheralMatchesAddress(linuxPeripheral, '748242c2fd60b5bcbf82dc811f382328'), false);
assert.equal(resolveNobleIdForAddress('ca:25:a6:0d:57:3d', [linuxPeripheral]), 'ca25a60d573d');

const macPeripheral: DiscoveredPeripheral = {
    id: '748242c2fd60b5bcbf82dc811f382328',
    address: 'ca:25:a6:0d:57:3d',
    name: 'NEEWER-RGB62',
    rssi: -50,
};

assert.equal(peripheralMatchesAddress(macPeripheral, 'ca:25:a6:0d:57:3d'), true);
assert.equal(peripheralMatchesAddress(macPeripheral, '748242c2fd60b5bcbf82dc811f382328'), false);
assert.equal(resolveNobleIdForAddress('ca:25:a6:0d:57:3d', [macPeripheral]), '748242c2fd60b5bcbf82dc811f382328');

console.log('bleLookup.test.ts: ok');
