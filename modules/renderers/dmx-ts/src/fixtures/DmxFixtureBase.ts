import { ConfiguredFixture } from '../handlers/ConfigHandler';
import { Logger } from '../Logger';
import { DmxUniverse } from '../DmxUniverse';
import { FixtureIntentSnapshot, IFixtureClass } from './IFixtureClass';
import { DmxMap } from './DmxMap';
import { FixtureSampleContext } from '../layerIntent/LayerIntentEngine';

export abstract class DmxFixtureBase implements IFixtureClass {
    private readonly dmxMaps = new WeakMap<ConfiguredFixture, DmxMap>();

    abstract applyIntentSnapshot(
        fixture: ConfiguredFixture,
        context: FixtureSampleContext,
        snapshot: FixtureIntentSnapshot,
        dmxUniverse: DmxUniverse
    ): void;

    protected getDmxBaseChannel(fixture: ConfiguredFixture): number | null {
        const v = fixture.params['dmxBaseChannel'];
        if (typeof v === 'number' && Number.isFinite(v)) {
            return v;
        }
        if (typeof v === 'string') {
            const n = Number(v);
            if (Number.isFinite(n)) {
                return n;
            }
        }
        return null;
    }

    protected writeFunction(
        fixture: ConfiguredFixture,
        functionName: string,
        normalizedValue: number,
        dmxUniverse: DmxUniverse
    ): void {
        const base = this.getDmxBaseChannel(fixture);
        if (base === null) {
            Logger.warn(`[dmx] fixture "${fixture.name}" missing or invalid params.dmxBaseChannel`);
            return;
        }
        const channel = this.getDmxMap(fixture).lookup(functionName);
        if (!channel) return;
        const dmxChannel = base + channel.offset;
        const dmxValue = DmxFixtureBase.normalizedToDmxRange(normalizedValue, channel.rangeMin, channel.rangeMax);
        dmxUniverse.setChannel(dmxChannel, dmxValue);
    }

    private getDmxMap(fixture: ConfiguredFixture): DmxMap {
        let dmxMap = this.dmxMaps.get(fixture);
        if (!dmxMap) {
            dmxMap = new DmxMap(fixture.fixtureProfile);
            this.dmxMaps.set(fixture, dmxMap);
        }
        return dmxMap;
    }

    protected static normalizedToDmxRange(normalized: number, min: number, max: number): number {
        const clamped = Math.max(0, Math.min(1, normalized));
        return Math.round(min + (max - min) * clamped);
    }
}
