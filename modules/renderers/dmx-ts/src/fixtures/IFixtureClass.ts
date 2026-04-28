import { ConfiguredFixture } from '../handlers/ConfigHandler';
import { DmxUniverse } from '../DmxUniverse';
import { FixtureSampleContext, IntentRecord } from '../layerIntent/LayerIntentEngine';

export interface RendererEvent {
    class: string;
    scheduled?: number;
    position?: [number, number, number];
    params?: Record<string, unknown>;
}

export interface FixtureIntentSnapshot {
    intentsByLayer: ReadonlyMap<number, IntentRecord>;
    sample<TValue>(capabilityKey: string): TValue | undefined;
}

export interface IFixtureClass {
    applyIntentSnapshot(
        fixture: ConfiguredFixture,
        context: FixtureSampleContext,
        snapshot: FixtureIntentSnapshot,
        dmxUniverse: DmxUniverse
    ): void;
}
