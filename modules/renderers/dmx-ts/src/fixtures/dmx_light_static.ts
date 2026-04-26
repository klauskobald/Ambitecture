import { Color } from '../color';
import { DmxUniverse } from '../DmxUniverse';
import { ConfiguredFixture } from '../handlers/ConfigHandler';
import { IFixtureClass, RendererEvent } from './IFixtureClass';
import { DmxMap } from './DmxMap';

interface LightColor {
    x: number;
    y: number;
    Y: number;
}

interface LightParams {
    color?: LightColor;
    strobe?: number;
    layer?: number;
    blend?: string;
    alpha?: number;
}

function normalizedToDmxRange(normalized: number, range: string): number {
    const parts = range.split('-');
    const min = parseInt(parts[0] ?? '0', 10);
    const max = parseInt(parts[1] ?? '255', 10);
    const clamped = Math.max(0, Math.min(1, normalized));
    return Math.round(min + (max - min) * clamped);
}

class DmxLightStatic implements IFixtureClass {
    private readonly dmxMaps = new WeakMap<ConfiguredFixture, DmxMap>();

    handleEvent(event: RendererEvent, fixture: ConfiguredFixture, dmxUniverse: DmxUniverse): void {
        if (event.class !== 'light') return;
        const colorData = (event.params as LightParams | undefined)?.color;
        if (!colorData) return;

        const color = new Color(colorData.x, colorData.y, colorData.Y);
        const { r, g, b } = color.toRGB();
        const strobe = (event.params as LightParams | undefined)?.strobe;
        if (strobe !== undefined) {
            if (strobe == 0) {
                this.writeFunction(fixture, 'strobe-off', 0, dmxUniverse);
            } else {
                this.writeFunction(fixture, 'strobe-on', strobe, dmxUniverse);
            }
        }

        this.writeFunction(fixture, 'red', r / 255, dmxUniverse);
        this.writeFunction(fixture, 'green', g / 255, dmxUniverse);
        this.writeFunction(fixture, 'blue', b / 255, dmxUniverse);
        this.writeFunction(fixture, 'brightness', colorData.Y, dmxUniverse);
    }

    private getDmxMap(fixture: ConfiguredFixture): DmxMap {
        let dmxMap = this.dmxMaps.get(fixture);
        if (!dmxMap) {
            dmxMap = new DmxMap(fixture.fixtureProfile);
            this.dmxMaps.set(fixture, dmxMap);
        }
        return dmxMap;
    }

    private writeFunction(
        fixture: ConfiguredFixture,
        functionName: string,
        normalizedValue: number,
        dmxUniverse: DmxUniverse
    ): void {
        const channel = this.getDmxMap(fixture).lookup(functionName);
        if (!channel) return;
        const dmxChannel = fixture.dmxBaseChannel + channel.offset;
        const dmxValue = normalizedToDmxRange(normalizedValue, channel.def.range);
        dmxUniverse.setChannel(dmxChannel, dmxValue);
    }
}

export default new DmxLightStatic();
