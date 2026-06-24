import { Color, rgbToHsv01 } from '../color';
import { NeewerBus } from '../NeewerBus';
import { ConfiguredFixture } from '../handlers/ConfigHandler';
import { FixtureIntentSnapshot, FixtureSampleContext } from './IFixtureClass';
import { NeewerLightBase } from './NeewerLightBase';

class NeewerBasic extends NeewerLightBase {
    applyIntentSnapshot(
        fixture: ConfiguredFixture,
        _context: FixtureSampleContext,
        snapshot: FixtureIntentSnapshot,
        bus: NeewerBus
    ): void {
        const masterBrightness = snapshot.sample<number>('master.brightness') ?? 1;
        const masterBlackout = snapshot.sample<boolean>('master.blackout') ?? false;
        const color = snapshot.sample<Color>('light.color.xyY', true) ?? Color.black();

        const spatialStrobe = snapshot.sample<number>('light.strobe') ?? 0;
        const aux = snapshot.sample<Record<string, number>>('light.aux') ?? {};
        const strobeValue = aux['strobe'] !== undefined ? aux['strobe'] : spatialStrobe;

        const { r, g, b } = color.toRGB();
        const scale = (masterBlackout ? 0 : 1) * Math.max(0, masterBrightness);
        const intensityScale = this.getIntensityGain(fixture, scale);
        const { h, s, v } = rgbToHsv01(r * intensityScale, g * intensityScale, b * intensityScale);

        // Asleep on blackout: once the lamp has settled at 0 output, stop driving the BLE bus.
        // The first dark frame still sends 0 (latch flips after), so the lamp actually turns off.
        const asleep = scale === 0 && this.sleepOnBlackoutEnabled(fixture);
        const skip = asleep && fixture.currentlyAsleep === true;
        fixture.currentlyAsleep = scale === 0;
        if (skip) return;

        this.sendHsvStrobed(fixture, bus, h, s, v, strobeValue);
    }
}

export default new NeewerBasic();
