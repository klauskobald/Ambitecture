import { Logger } from '../src/Logger';
import { NobleBleBus } from '../src/ble/NobleBleBus';
import { DiscoveryService } from '../src/ble/DiscoveryService';

const SCAN_SECONDS = Number(process.env['NEEWER_SCAN_SECONDS'] ?? 10);

async function main(): Promise<void> {
    const bus = new NobleBleBus();
    const discovery = new DiscoveryService(bus, 5_000);

    Logger.info(`[discover] starting (${SCAN_SECONDS}s)`);
    await discovery.start();
    await new Promise<void>((r) => setTimeout(r, SCAN_SECONDS * 1000));
    await discovery.stop();
    await bus.stop();

    const found = discovery.listKnown();
    if (found.length === 0) {
        Logger.warn('[discover] no Neewer-looking peripherals were seen');
        Logger.warn('         make sure each light is powered on and not connected to the Neewer app');
    } else {
        Logger.info(`[discover] ${found.length} peripheral(s) — copy bluetoothAddress into project fixture params:`);
        for (const p of found) {
            const addr = p.address;
            if (addr === undefined) {
                Logger.warn(`  ${p.name ?? '(no name)'}: no BLE address reported (rssi=${p.rssi})`);
                continue;
            }
            console.log(`  ${p.name ?? '(no name)'}:`);
            console.log(`    bluetoothAddress: ${addr}`);
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        Logger.error('[discover] fatal', err);
        process.exit(1);
    });
