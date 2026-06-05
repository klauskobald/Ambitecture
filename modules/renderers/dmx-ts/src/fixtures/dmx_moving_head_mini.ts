import { Color } from '../color';
import { DmxUniverse } from '../DmxUniverse';
import { ConfiguredFixture } from '../handlers/ConfigHandler';
import { FixtureIntentSnapshot } from './IFixtureClass';
import { DmxFixtureBase } from './DmxFixtureBase';
import { FixtureSampleContext } from '../layerIntent/LayerIntentEngine';

class DmxMovingHeadMini extends DmxFixtureBase {
    applyIntentSnapshot(
        fixture: ConfiguredFixture,
        _context: FixtureSampleContext,
        snapshot: FixtureIntentSnapshot,
        dmxUniverse: DmxUniverse
    ): void {
        const masterBrightness = snapshot.sample<number>('master.brightness') ?? 1;
        const masterBlackout = snapshot.sample<boolean>('master.blackout') ?? false;
        const trimBrightness = this.getTrimBrightness(fixture);
        const blackoutFactor = masterBlackout ? 0 : 1;

        const color = snapshot.sample<Color>('light.color.xyY', true) ?? Color.black();
        const { r, g, b, w } = color.toRGBW();

        const spatialStrobe = snapshot.sample<number>('light.strobe') ?? 0;
        const aux = snapshot.sample<Record<string, number>>('light.aux') ?? {};
        const strobeValue = aux['strobe'] !== undefined ? aux['strobe'] : spatialStrobe;
        const strobeOn = strobeValue > 0;

        // Brightness/strobe share one DMX channel. While strobing the hardware forces full
        // output, so the master dimmer must scale the color channels; with strobe off the
        // dimmer rides on the brightness channel and the color stays at full level.
        if (strobeOn) {
            const colorScale = Math.max(0, Math.min(1, masterBrightness)) * blackoutFactor * trimBrightness;
            this.writeFunction(fixture, 'red', r * colorScale, dmxUniverse);
            this.writeFunction(fixture, 'green', g * colorScale, dmxUniverse);
            this.writeFunction(fixture, 'blue', b * colorScale, dmxUniverse);
            this.writeFunction(fixture, 'white', w * colorScale, dmxUniverse);
            this.writeFunction(fixture, 'strobe-on', strobeValue, dmxUniverse);
        } else {
            const boostBrightness = masterBrightness > 1 ? masterBrightness : 1;
            const rgbTrim = boostBrightness > 1 ? trimBrightness : 1;
            const colorScale = boostBrightness * rgbTrim;
            this.writeFunction(fixture, 'red', r * colorScale, dmxUniverse);
            this.writeFunction(fixture, 'green', g * colorScale, dmxUniverse);
            this.writeFunction(fixture, 'blue', b * colorScale, dmxUniverse);
            this.writeFunction(fixture, 'white', w * colorScale, dmxUniverse);
            const dimmer = Math.max(0, Math.min(1, masterBrightness)) * blackoutFactor * trimBrightness;
            this.writeFunction(fixture, 'brightness', dimmer, dmxUniverse);
        }

        for (const [functionName, value] of Object.entries(aux)) {
            if (functionName === 'strobe') continue;
            this.writeFunction(fixture, functionName, value, dmxUniverse);
        }
    }
}

export default new DmxMovingHeadMini();
