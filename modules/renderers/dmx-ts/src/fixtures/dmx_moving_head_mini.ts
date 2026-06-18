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
            const colorScale = Math.max(0, masterBrightness) * blackoutFactor;
            const intensityFactor = this.getIntensityGain(fixture, colorScale);
            this.writeFunction(fixture, 'red', r * intensityFactor, dmxUniverse);
            this.writeFunction(fixture, 'green', g * intensityFactor, dmxUniverse);
            this.writeFunction(fixture, 'blue', b * intensityFactor, dmxUniverse);
            this.writeFunction(fixture, 'white', w * intensityFactor, dmxUniverse);
            this.writeFunction(fixture, 'strobe-on', strobeValue, dmxUniverse);
        } else {
            const colorScale = masterBrightness;
            this.writeFunction(fixture, 'red', r * colorScale, dmxUniverse);
            this.writeFunction(fixture, 'green', g * colorScale, dmxUniverse);
            this.writeFunction(fixture, 'blue', b * colorScale, dmxUniverse);
            this.writeFunction(fixture, 'white', w * colorScale, dmxUniverse);
            const dimmer = Math.max(0, masterBrightness) * blackoutFactor;
            this.writeFunction(fixture, 'brightness', this.getIntensityGain(fixture, Math.max(0, dimmer)), dmxUniverse);
        }

        for (const [functionName, value] of Object.entries(aux)) {
            if (functionName === 'strobe') continue;
            this.writeFunction(fixture, functionName, value, dmxUniverse);
        }

        const target = snapshot.sample<[number, number, number]>('target') ?? null;
        this.applyAim(fixture, context, target, dmxUniverse);
    }

    /**
     * Aim the head at the hub-resolved lookAt point. `xy-speed` is parked at 0 since the hub eases the
     * target itself.
     *
     * Each beam direction has two reachable (pan, tilt) poses: aim "front" (tilt below the up-centre) or
     * "over the top" (pan held, tilt swung past vertical to the back). We track the head's continuous
     * world front-heading and, **outside** a near-vertical cone, snap it to whichever of `heading` /
     * `heading+180` is closer — so once the beam has gone over the top it stays there instead of spinning
     * pan 180°. **Inside** the cone the front-heading is frozen and tilt alone carries the beam through
     * vertical (the in-plane formula stays continuous as the target crosses overhead). This trades a tiny
     * pointing error very close to straight-up for smooth motion and use of the full tilt range.
     */
    private applyAim(
        fixture: ConfiguredFixture,
        context: FixtureSampleContext,
        target: [number, number, number] | null,
        dmxUniverse: DmxUniverse
    ): void {
        this.writeFunction(fixture, 'xy-speed', 0, dmxUniverse);

        const panDegrees = this.getFunctionDegrees(fixture, 'pan');
        const tiltDegrees = this.getFunctionDegrees(fixture, 'tilt');
        const hasTilt = !!tiltDegrees && tiltDegrees > 0;

        if (!target) {
            if (hasTilt) this.writeFunction(fixture, 'tilt', 0, dmxUniverse);
            return;
        }
        if (!panDegrees || panDegrees <= 0) return;

        const [fx, fy, fz] = context.fixtureWorldPos;
        const dx = target[0] - fx;
        const dz = target[2] - fz;
        const horizontalDist = Math.hypot(dx, dz);
        const headDown = fixture.params['headDown'] === true;
        const dy = headDown ? fy - target[1] : target[1] - fy;

        const headingDeg = Math.atan2(dz, dx) * (180 / Math.PI);

        // Pan-only head: keep the simple single-solution aim (no over-top branch).
        if (!hasTilt) {
            this.writePan(fixture, headingDeg, panDegrees, dmxUniverse);
            return;
        }

        // Zenith from straight-up (0 = overhead, 90 = horizon). The cone is measured here.
        const zenithDeg = Math.atan2(horizontalDist, dy) * (180 / Math.PI);
        const prevFrontHeading = fixture.currentAimHeadingDeg ?? headingDeg;

        // Outside the cone we may re-commit the front-heading to the nearer of the two poses; inside it
        // stays frozen so the fast azimuth swing around the zenith never spins pan.
        let frontHeading = prevFrontHeading;
        if (zenithDeg >= OVER_TOP_CONE_DEG) {
            const frontCandidate = nearestHeading(headingDeg, prevFrontHeading);
            const overTopCandidate = nearestHeading(headingDeg + 180, prevFrontHeading);
            frontHeading =
                Math.abs(frontCandidate - prevFrontHeading) <= Math.abs(overTopCandidate - prevFrontHeading)
                    ? frontCandidate
                    : overTopCandidate;
        }
        fixture.currentAimHeadingDeg = frontHeading;

        // In-plane beam angle within the (frozen-or-tracked) front-heading plane. cos(rel) < 0 means the
        // target sits behind the front, i.e. the beam is over the top → inPlaneTilt passes 90° smoothly.
        const relRad = normalizeTo180(headingDeg - frontHeading) * (Math.PI / 180);
        const inPlaneTiltDeg = Math.atan2(dy, horizontalDist * Math.cos(relRad)) * (180 / Math.PI);

        this.writePan(fixture, frontHeading, panDegrees, dmxUniverse);
        this.writeTilt(fixture, inPlaneTiltDeg, tiltDegrees, dmxUniverse);
    }

    /** Mechanical pan write with reverse/trim and >360° unwrap continuity. */
    private writePan(
        fixture: ConfiguredFixture,
        headingDeg: number,
        panDegrees: number,
        dmxUniverse: DmxUniverse
    ): void {
        const mount = readAxisMount(fixture, 'pan');
        let mechHeading = mount.reverse ? -headingDeg : headingDeg;
        mechHeading += mount.trimDegrees;
        const next = panUnwrap(fixture.currentPanDeg ?? panDegrees / 2, mechHeading, panDegrees);
        fixture.currentPanDeg = next;
        this.writeFunction(fixture, 'pan', next / panDegrees, dmxUniverse);
    }

    /** Map an in-plane beam angle (0 = front horizon, 90 = up, 180 = back horizon) onto mechanical tilt. */
    private writeTilt(
        fixture: ConfiguredFixture,
        inPlaneTiltDeg: number,
        tiltDegrees: number,
        dmxUniverse: DmxUniverse
    ): void {
        const mount = readAxisMount(fixture, 'tilt');
        const offsetFromUp = inPlaneTiltDeg - 90;
        const tiltDeg = tiltDegrees / 2 + (mount.reverse ? -offsetFromUp : offsetFromUp) + mount.trimDegrees;
        this.writeFunction(fixture, 'tilt', tiltDeg / tiltDegrees, dmxUniverse);
    }
}

/**
 * Half-angle (deg) of the near-vertical cone where pan freezes and tilt carries the beam over the top.
 * Kept tight so pan tracks the target normally everywhere except an almost-dead-overhead crossing.
 */
const OVER_TOP_CONE_DEG = 2;

/** Representation of `targetDeg` (any sign) on the same continuous turn as `referenceDeg` (within ±180°). */
function nearestHeading(targetDeg: number, referenceDeg: number): number {
    const delta = (((targetDeg - referenceDeg) % 360) + 540) % 360 - 180;
    return referenceDeg + delta;
}

/** Fold a degree difference into [-180, 180). */
function normalizeTo180(deg: number): number {
    return (((deg % 360) + 540) % 360) - 180;
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
