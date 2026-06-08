import WebSocket from 'ws';
import { NeewerBus } from '../NeewerBus';
import { ConfigHandler, ConfiguredFixture } from './ConfigHandler';
import { Color } from '../color';
import { FixtureIntentSnapshot, FixtureSampleContext } from '../fixtures/IFixtureClass';
import { strobeRegistry } from '../StrobeRegistry';

interface WsMessage {
    type: string;
    payload?: unknown;
}

interface FixtureStateEntry {
    fixtureGuid: string;
    caps: Record<string, unknown>;
}

function fixtureWorldPosition(
    fixture: ConfiguredFixture,
    bbox: [number, number, number, number, number, number]
): [number, number, number] {
    return [bbox[0] + fixture.location[0], bbox[1] + fixture.location[1], bbox[2] + fixture.location[2]];
}

/** `light.color.xyY` arrives as `[x,y,Y]`; rewrap into a renderer Color so fixture classes are unchanged. */
function sampleCap(caps: Record<string, unknown>, key: string): unknown {
    const v = caps[key];
    if (v === undefined) return undefined;
    if (key === 'light.color.xyY' && Array.isArray(v) && v.length === 3) {
        return new Color(v[0] as number, v[1] as number, v[2] as number);
    }
    return v;
}

/**
 * Consumes the hub's resolved per-fixture `fixtureState` stream and feeds each fixture's `caps` to the
 * fixture classes' `applyIntentSnapshot` (which write the Neewer BLE bus). All resolution is hub-side.
 */
export class FixtureStateHandler {
    private capsByFixture = new Map<string, Record<string, unknown>>();

    constructor(private configHandler: ConfigHandler, private neewerBus: NeewerBus) {}

    handle(_ws: WebSocket, message: WsMessage): void {
        const entries = message.payload as FixtureStateEntry[];
        if (!Array.isArray(entries)) return;
        for (const e of entries) {
            if (e && typeof e.fixtureGuid === 'string' && e.caps && typeof e.caps === 'object') {
                this.capsByFixture.set(e.fixtureGuid, e.caps);
            }
        }
        this.applyAllFixtures();
    }

    reapplyCurrentIntents(): void {
        // A fresh config may change strobe params or drop fixtures; tear timers down and re-arm.
        strobeRegistry.stopAll();
        this.applyAllFixtures();
    }

    private applyAllFixtures(): void {
        const zones = this.configHandler.getZones();
        if (zones.length === 0) return;
        for (const zone of zones) {
            for (const fixture of zone.fixtures) {
                const context: FixtureSampleContext = {
                    fixture,
                    fixtureWorldPos: fixtureWorldPosition(fixture, zone.boundingBox),
                    zoneName: zone.name,
                };
                const caps = (fixture.guid ? this.capsByFixture.get(fixture.guid) : undefined) ?? {};
                const snapshot: FixtureIntentSnapshot = {
                    sample: <TValue>(capabilityKey: string) => sampleCap(caps, capabilityKey) as TValue | undefined,
                };
                fixture.fixtureClass.applyIntentSnapshot(fixture, context, snapshot, this.neewerBus);
            }
        }
    }
}
