import { ConfiguredFixture } from '../handlers/ConfigHandler';
import { DmxUniverse } from '../DmxUniverse';
import { IFixtureClass, RendererEvent } from './IFixtureClass';
import { DmxMap } from './DmxMap';

export abstract class DmxFixtureBase implements IFixtureClass {
    private readonly dmxMaps = new WeakMap<ConfiguredFixture, DmxMap>();

    abstract handleEvent(event: RendererEvent, fixture: ConfiguredFixture, dmxUniverse: DmxUniverse): void;

    protected writeFunction(
        fixture: ConfiguredFixture,
        functionName: string,
        normalizedValue: number,
        dmxUniverse: DmxUniverse
    ): void {
        const channel = this.getDmxMap(fixture).lookup(functionName);
        if (!channel) return;
        const dmxChannel = fixture.dmxBaseChannel + channel.offset;
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
