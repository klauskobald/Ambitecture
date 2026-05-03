import { Color } from '../color';
import { DmxUniverse } from '../DmxUniverse';
import { ConfiguredFixture } from '../handlers/ConfigHandler';
import { FixtureIntentSnapshot } from './IFixtureClass';
import { DmxFixtureBase } from './DmxFixtureBase';
import { FixtureSampleContext } from '../layerIntent/LayerIntentEngine';

class DmxLightStatic extends DmxFixtureBase {
    applyIntentSnapshot(
        fixture: ConfiguredFixture,
        _context: FixtureSampleContext,
        snapshot: FixtureIntentSnapshot,
        dmxUniverse: DmxUniverse
    ): void {
        // THIS IS NOT WORKING AS EXPECTED.
        // const xbrightness = snapshot.sample<number>('light.brightness') || 1;
        // const withSpatial = xbrightness == 0 || xbrightness == 1;
        const xbrightness = 1;
        const withSpatial = true
        const masterBrightness = snapshot.sample<number>('master.brightness') ?? 1;
        const boostBrightness = masterBrightness > 1 ? masterBrightness : 1;

        const color = snapshot.sample<Color>('light.color.xyY', withSpatial) ?? Color.black();
        const { r, g, b } = color.toRGB();
        this.writeFunction(fixture, 'red', r * boostBrightness, dmxUniverse);
        this.writeFunction(fixture, 'green', g * boostBrightness, dmxUniverse);
        this.writeFunction(fixture, 'blue', b * boostBrightness, dmxUniverse);

        const spatialStrobe = snapshot.sample<number>('light.strobe') ?? 0;
        // aux writes after color; aux keys intentionally override color-pipeline channels
        const aux = snapshot.sample<Record<string, number>>('light.aux') ?? {};
        const strobeValue = aux['strobe'] !== undefined ? aux['strobe'] : spatialStrobe;
        if (strobeValue === 0) {
            this.writeFunction(fixture, 'strobe-off', 0, dmxUniverse);
        } else {
            this.writeFunction(fixture, 'strobe-on', strobeValue, dmxUniverse);
        }
        for (const [functionName, value] of Object.entries(aux)) {
            if (functionName === 'strobe') continue;
            this.writeFunction(fixture, functionName, value, dmxUniverse);
        }

        const masterBlackout = snapshot.sample<boolean>('master.blackout') ?? false;
        const brightness = xbrightness * masterBrightness * (masterBlackout ? 0 : 1);
        this.writeFunction(fixture, 'brightness', Math.max(0, Math.min(1, brightness)), dmxUniverse);
    }
}

export default new DmxLightStatic();
