import { Color } from '../color';
import { DmxUniverse } from '../DmxUniverse';
import { ConfiguredFixture } from '../handlers/ConfigHandler';
import { FixtureIntentSnapshot, FixtureSampleContext } from './IFixtureClass';
import { DmxFixtureBase } from './DmxFixtureBase';
import { panUnwrap } from '../panUnwrap';

class DmxMovingHeadMini extends DmxFixtureBase {
    applyIntentSnapshot(
        fixture: ConfiguredFixture,
        context: FixtureSampleContext,
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

        const target = snapshot.sample<[number, number, number]>('target') ?? null;
        this.applyPan(fixture, context, target, dmxUniverse);
        this.applyTilt(fixture, context, target, dmxUniverse);
    }

    // Pan aims at the hub-resolved lookAt point (simple vector math). xy-speed is parked at 0 since the
    // hub eases the target itself. Pan unwrap keeps >360° continuity.
    private applyPan(
        fixture: ConfiguredFixture,
        context: FixtureSampleContext,
        target: [number, number, number] | null,
        dmxUniverse: DmxUniverse
    ): void {
        this.writeFunction(fixture, 'xy-speed', 0, dmxUniverse);

        const panDegrees = this.getFunctionDegrees(fixture, 'pan');
        if (!panDegrees || panDegrees <= 0 || !target) return;

        const [fx, , fz] = context.fixtureWorldPos;
        const mount = readAxisMount(fixture, 'pan');
        let headingDeg = Math.atan2(target[2] - fz, target[0] - fx) * (180 / Math.PI);
        if (mount.reverse) headingDeg = -headingDeg;
        headingDeg += mount.trimDegrees;

        const current = fixture.currentPanDeg ?? panDegrees / 2;
        const next = panUnwrap(current, headingDeg, panDegrees);
        fixture.currentPanDeg = next;
        this.writeFunction(fixture, 'pan', next / panDegrees, dmxUniverse);
    }

    // Tilt aims at the elevation of the hub-resolved lookAt point. The vertical angle from the fixture to
    // the target maps onto the head's mechanical range, centred (range/2) on the horizontal plane.
    private applyTilt(
        fixture: ConfiguredFixture,
        context: FixtureSampleContext,
        target: [number, number, number] | null,
        dmxUniverse: DmxUniverse
    ): void {
        const tiltDegrees = this.getFunctionDegrees(fixture, 'tilt');
        if (!tiltDegrees || tiltDegrees <= 0 || !target) {
            this.writeFunction(fixture, 'tilt', 0, dmxUniverse);
            return;
        }

        const [fx, fy, fz] = context.fixtureWorldPos;
        const horizontalDist = Math.hypot(target[0] - fx, target[2] - fz);
        const mount = readAxisMount(fixture, 'tilt');
        // Negated so the centred range maps a target above the fixture to "beam up". Physical
        // mounting orientation is handled separately by mount.reverse.
        let elevationDeg = -Math.atan2(horizontalDist, target[1] - fy) * (180 / Math.PI);
        if (mount.reverse) elevationDeg = -elevationDeg;

        const tiltDeg = tiltDegrees / 2 + elevationDeg + mount.trimDegrees;
        this.writeFunction(fixture, 'tilt', tiltDeg / tiltDegrees, dmxUniverse);
    }
}

/** Per-instance mount calibration (dmx-only — depends on physical mounting). */
function readAxisMount(
    fixture: ConfiguredFixture,
    axis: 'pan' | 'tilt'
): { trimDegrees: number; reverse: boolean } {
    const raw = fixture.params[axis];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { trimDegrees: 0, reverse: false };
    }
    const o = raw as Record<string, unknown>;
    const trimDegrees = typeof o['trimDegrees'] === 'number' && Number.isFinite(o['trimDegrees']) ? o['trimDegrees'] : 0;
    return { trimDegrees, reverse: o['reverse'] === true };
}

export default new DmxMovingHeadMini();
