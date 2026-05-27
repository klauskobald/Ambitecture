import { ConfiguredFixture } from '../handlers/ConfigHandler';
import { NeewerBus } from '../NeewerBus';
import { FixtureSampleContext, IntentRecord } from '../layerIntent/LayerIntentEngine';

export interface RendererEvent {
    guid?: string;
    layer?: number;
    class: string;
    scheduled?: number;
    position?: [number, number, number];
    radius?: number;
    radiusFunction?: string;
    params?: Record<string, unknown>;
    removed?: boolean;
}

export interface FixtureIntentSnapshot {
    intentsByLayer: ReadonlyMap<string, IntentRecord>;
    sample<TValue>(capabilityKey: string, withSpatialFactor?: boolean): TValue | undefined;
}

export interface IFixtureClass {
    applyIntentSnapshot(
        fixture: ConfiguredFixture,
        context: FixtureSampleContext,
        snapshot: FixtureIntentSnapshot,
        bus: NeewerBus
    ): void;
}
