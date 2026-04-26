import { Color } from '../color';
import { DmxUniverse } from '../DmxUniverse';
import { ConfiguredFixture, FixtureChannelDef, FixtureProfile } from '../handlers/ConfigHandler';
import { IFixtureClass, RendererEvent } from './IFixtureClass';

interface LightColor {
    x: number;
    y: number;
    Y: number;
}

interface LightParams {
    color?: LightColor;
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

function findChannel(
    profile: FixtureProfile,
    functionName: string
): { offset: number; def: FixtureChannelDef } | null {
    for (const [offsetStr, defs] of Object.entries(profile.params.dmx)) {
        for (const def of defs) {
            if (def.function === functionName) {
                return { offset: parseInt(offsetStr, 10), def };
            }
        }
    }
    return null;
}

class DmxLightStatic implements IFixtureClass {
    handleEvent(event: RendererEvent, fixture: ConfiguredFixture, dmxUniverse: DmxUniverse): void {
        if (event.class !== 'light') return;
        const colorData = (event.params as LightParams | undefined)?.color;
        if (!colorData) return;

        const color = new Color(colorData.x, colorData.y, colorData.Y);
        const { r, g, b } = color.toRGB();

        this.writeFunction(fixture, 'red',        r / 255,      dmxUniverse);
        this.writeFunction(fixture, 'green',      g / 255,      dmxUniverse);
        this.writeFunction(fixture, 'blue',       b / 255,      dmxUniverse);
        this.writeFunction(fixture, 'brightness', colorData.Y,  dmxUniverse);
        this.writeFunction(fixture, 'strobe-off', 0,            dmxUniverse);
    }

    private writeFunction(
        fixture: ConfiguredFixture,
        functionName: string,
        normalizedValue: number,
        dmxUniverse: DmxUniverse
    ): void {
        const result = findChannel(fixture.fixtureProfile, functionName);
        if (!result) return;
        const dmxChannel = fixture.dmxBaseChannel + result.offset;
        const dmxValue = normalizedToDmxRange(normalizedValue, result.def.range);
        dmxUniverse.setChannel(dmxChannel, dmxValue);
    }
}

export default new DmxLightStatic();
