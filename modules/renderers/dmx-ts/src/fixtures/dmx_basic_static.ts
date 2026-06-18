import { Color } from '../color';
import { DmxUniverse } from '../DmxUniverse';
import { ConfiguredFixture } from '../handlers/ConfigHandler';
import { FixtureIntentSnapshot, FixtureSampleContext } from './IFixtureClass';
import { DmxFixtureBase } from './DmxFixtureBase';

class DmxBasicStatic extends DmxFixtureBase {
    applyIntentSnapshot(
        fixture: ConfiguredFixture,
        _context: FixtureSampleContext,
        snapshot: FixtureIntentSnapshot,
        dmxUniverse: DmxUniverse
    ): void {
        const masterBrightness = snapshot.sample<number>('master.brightness') ?? 1;
        const masterBlackout = snapshot.sample<boolean>('master.blackout') ?? false;

        const color = snapshot.sample<Color>('light.color.xyY', true) ?? Color.black();
        const { r, g, b } = color.toRGB();

        const brightnessFactor =
            Math.max(0, masterBrightness) *
            (masterBlackout ? 0 : 1) *
            masterBrightness;
        const intensityFactor = this.getIntensityGain(fixture, Math.max(0, brightnessFactor));

        this.writeFunction(fixture, 'red', r * intensityFactor, dmxUniverse);
        this.writeFunction(fixture, 'green', g * intensityFactor, dmxUniverse);
        this.writeFunction(fixture, 'blue', b * intensityFactor, dmxUniverse);

        const aux = snapshot.sample<Record<string, number>>('light.aux') ?? {};
        for (const [functionName, value] of Object.entries(aux)) {
            this.writeFunction(fixture, functionName, value, dmxUniverse);
        }
    }
}

export default new DmxBasicStatic();
