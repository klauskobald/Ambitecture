import { ConfiguredFixture } from '../handlers/ConfigHandler';
import { Logger } from '../Logger';
import { DmxUniverse } from '../DmxUniverse';
import { FixtureIntentSnapshot, IFixtureClass } from './IFixtureClass';
import { DmxMap } from './DmxMap';
import { FixtureSampleContext } from './IFixtureClass';
import { FnCurve } from '../FnCurve';

export abstract class DmxFixtureBase implements IFixtureClass {
    private readonly dmxMaps = new WeakMap<ConfiguredFixture, DmxMap>();

    abstract applyIntentSnapshot(
        fixture: ConfiguredFixture,
        context: FixtureSampleContext,
        snapshot: FixtureIntentSnapshot,
        dmxUniverse: DmxUniverse
    ): void;

    /**
     * Effective `power.sleepOnBlackout`: per-instance override (`params.power.sleepOnBlackout`)
     * falling back to the profile default (`fixtureProfile.params.power.sleepOnBlackout`). When on
     * and the fixture's resolved output is 0, the fixture class stops driving its sleepable hardware.
     */
    protected sleepOnBlackoutEnabled(fixture: ConfiguredFixture): boolean {
        const instance = readPowerSleep(fixture.params);
        if (instance !== undefined) return instance;
        return readPowerSleep(fixture.fixtureProfile.params as Record<string, unknown>) ?? false;
    }

    protected getDmxBaseChannel(fixture: ConfiguredFixture): number | null {
        const v = fixture.params['dmxBaseChannel'];
        if (typeof v === 'number' && Number.isFinite(v)) {
            return v;
        }
        if (typeof v === 'string') {
            const n = Number(v);
            if (Number.isFinite(n)) {
                return n;
            }
        }
        return null;
    }

    /**
     * Hardware-abstract instance gain: shapes the brightness response with
     * `params.intensityFn` defaults to `'linear'` (identity), `params.intensityTrim` to 1.
     * Each fixture class calls this with the already-computed dimmer/level before writing
     * to hardware. `simulator-2d` ignores these params entirely.
     */
    protected getIntensityGain(fixture: ConfiguredFixture, level: number): number {
        const trimVal = typeof fixture.intensityTrim === 'number' && Number.isFinite(fixture.intensityTrim) && fixture.intensityTrim >= 0
            ? fixture.intensityTrim
            : 1;
        const fnVal = typeof fixture.intensityFn === 'string' && fixture.intensityFn.length > 0
            ? fixture.intensityFn
            : 'linear';
        return FnCurve.evaluate(fnVal, level * trimVal);
    }

    protected writeFunction(
        fixture: ConfiguredFixture,
        functionName: string,
        normalizedValue: number,
        dmxUniverse: DmxUniverse
    ): void {
        const base = this.getDmxBaseChannel(fixture);
        if (base === null) {
            Logger.warn(`[dmx] fixture "${fixture.name}" missing or invalid params.dmxBaseChannel`);
            return;
        }
        const channel = this.getDmxMap(fixture).lookup(functionName);
        if (!channel) return;
        const dmxChannel = base + channel.offset;
        const dmxValue = DmxFixtureBase.normalizedToDmxRange(normalizedValue, channel.rangeMin, channel.rangeMax);
        dmxUniverse.setChannel(dmxChannel, dmxValue);
    }

    /** Physical span (deg) of a positional channel (e.g. `pan`), from the profile; undefined if absent. */
    protected getFunctionDegrees(fixture: ConfiguredFixture, functionName: string): number | undefined {
        return this.getDmxMap(fixture).lookup(functionName)?.degrees;
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

/** Read `power.sleepOnBlackout` from a `params`-shaped bag; undefined when the key is absent. */
function readPowerSleep(params: Record<string, unknown> | undefined): boolean | undefined {
    const power = params?.['power'];
    if (!power || typeof power !== 'object' || Array.isArray(power)) return undefined;
    const v = (power as Record<string, unknown>)['sleepOnBlackout'];
    return typeof v === 'boolean' ? v : undefined;
}
