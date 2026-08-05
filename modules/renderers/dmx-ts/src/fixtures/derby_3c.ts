import { Color } from '../color';
import { DmxUniverse } from '../DmxUniverse';
import { ConfiguredFixture } from '../handlers/ConfigHandler';
import { FixtureIntentSnapshot, FixtureSampleContext } from './IFixtureClass';
import { DmxFixtureBase } from './DmxFixtureBase';
import { panUnwrap } from '../panUnwrap';

/**
 * RGB derby with a single spin motor on `pan` and a reverse-mapped strobe
 * (hardware: slowest ≈ rangeMax, fastest ≈ rangeMin — via channel `reversed: true`).
 * Exact beam angle is unknown; pan tracks hub `target` heading like a pan-only moving head.
 */
class Derby3c extends DmxFixtureBase {
    applyIntentSnapshot(
        fixture: ConfiguredFixture,
        context: FixtureSampleContext,
        snapshot: FixtureIntentSnapshot,
        dmxUniverse: DmxUniverse
    ): void {
        const masterBrightness = snapshot.sample<number>('master.brightness') ?? 1;
        const masterBlackout = snapshot.sample<boolean>('master.blackout') ?? false;
        const blackoutFactor = masterBlackout ? 0 : 1;

        const color = snapshot.sample<Color>('light.color.xyY', true) ?? Color.black();
        const { r, g, b } = color.toRGB();
        this.writeFunction(fixture, 'red', r * masterBrightness, dmxUniverse);
        this.writeFunction(fixture, 'green', g * masterBrightness, dmxUniverse);
        this.writeFunction(fixture, 'blue', b * masterBrightness, dmxUniverse);

        const spatialStrobe = snapshot.sample<number>('light.strobe') ?? 0;
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

        const brightness = Math.max(0, masterBrightness) * blackoutFactor;
        this.writeFunction(fixture, 'brightness', this.getIntensityGain(fixture, brightness), dmxUniverse);

        // Not shining: dimmer off or RGB all zero — hold the spin motor still.
        const isDark = brightness === 0 || (r === 0 && g === 0 && b === 0);
        const isAsleep = isDark && this.sleepOnBlackoutEnabled(fixture);
        const target = snapshot.sample<[number, number, number]>('target') ?? null;
        if (!isAsleep) this.applyPan(fixture, context, target, dmxUniverse);
    }

    /** Approximate spin toward the hub lookAt point — physical angle is not calibrated. */
    private applyPan(
        fixture: ConfiguredFixture,
        context: FixtureSampleContext,
        target: [number, number, number] | null,
        dmxUniverse: DmxUniverse
    ): void {
        const panDegrees = this.getFunctionDegrees(fixture, 'pan');
        if (!panDegrees || panDegrees <= 0) return;
        if (!target) return;

        const [fx, , fz] = context.fixtureWorldPos;
        const dx = target[0] - fx;
        const dz = target[2] - fz;
        const headingDeg = Math.atan2(dz, dx) * (180 / Math.PI);

        const mount = readPanMount(fixture);
        let mechHeading = mount.reverse ? -headingDeg : headingDeg;
        mechHeading += mount.trimDegrees;
        const next = panUnwrap(fixture.currentPanDeg ?? panDegrees / 2, mechHeading, panDegrees);
        fixture.currentPanDeg = next;
        this.writeFunction(fixture, 'pan', next / panDegrees, dmxUniverse);
    }
}

function readPanMount(fixture: ConfiguredFixture): { trimDegrees: number; reverse: boolean } {
    const raw = fixture.params['pan'];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { trimDegrees: 0, reverse: false };
    }
    const o = raw as Record<string, unknown>;
    const trimDegrees =
        typeof o['trimDegrees'] === 'number' && Number.isFinite(o['trimDegrees']) ? o['trimDegrees'] : 0;
    return { trimDegrees, reverse: o['reverse'] === true };
}

export default new Derby3c();
