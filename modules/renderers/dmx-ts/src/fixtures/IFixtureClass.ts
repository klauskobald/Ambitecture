import { ConfiguredFixture } from '../handlers/ConfigHandler';
import { DmxUniverse } from '../DmxUniverse';

export interface FixtureSampleContext {
    fixture: ConfiguredFixture;
    fixtureWorldPos: [number, number, number];
    zoneName: string;
}

/** Hub-resolved per-fixture capabilities; `sample(key)` reads the value the hub already resolved. */
export interface FixtureIntentSnapshot {
    sample<TValue>(capabilityKey: string, withSpatialFactor?: boolean): TValue | undefined;
}

export interface IFixtureClass {
    applyIntentSnapshot(
        fixture: ConfiguredFixture,
        context: FixtureSampleContext,
        snapshot: FixtureIntentSnapshot,
        dmxUniverse: DmxUniverse
    ): void;
}
