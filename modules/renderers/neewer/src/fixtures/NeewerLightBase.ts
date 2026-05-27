import { ConfiguredFixture } from '../handlers/ConfigHandler';
import { NeewerBus } from '../NeewerBus';
import { FixtureSampleContext } from '../layerIntent/LayerIntentEngine';
import { FixtureIntentSnapshot, IFixtureClass } from './IFixtureClass';
import * as NeewerProtocol from '../ble/NeewerProtocol';
import { FnCurve } from '../FnCurve';

export abstract class NeewerLightBase implements IFixtureClass {
    abstract applyIntentSnapshot(
        fixture: ConfiguredFixture,
        context: FixtureSampleContext,
        snapshot: FixtureIntentSnapshot,
        bus: NeewerBus
    ): void;

    protected getTrimBrightness(fixture: ConfiguredFixture): number {
        const value = fixture.trim?.brightness;
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
            return value;
        }
        return 1;
    }

    protected sendHsv(fixture: ConfiguredFixture, bus: NeewerBus, hue: number, sat: number, bri: number): void {
        void bus.send(fixture, NeewerProtocol.hsv(hue, sat, this.curveBrightness(fixture, bri)));
    }

    protected sendCct(fixture: ConfiguredFixture, bus: NeewerBus, kelvin: number, bri: number): void {
        void bus.send(fixture, NeewerProtocol.cct(kelvin, this.curveBrightness(fixture, bri)));
    }

    // Neewer lamps reach near-full perceived output by ~25% input, so the brightness
    // channel carries a response function (e.g. quadratic) that we apply on output to
    // linearise perception. bri is a 0–100 percent; the curve runs in normalised [0,1].
    private curveBrightness(fixture: ConfiguredFixture, bri: number): number {
        const fn = this.getBrightnessFunction(fixture);
        if (fn === undefined) return bri;
        return FnCurve.evaluate(fn, bri / 100) * 100;
    }

    private getBrightnessFunction(fixture: ConfiguredFixture): string | undefined {
        const channels = fixture.fixtureProfile.params['channels'];
        if (!channels || typeof channels !== 'object') return undefined;
        const brightness = (channels as Record<string, unknown>)['brightness'];
        if (!brightness || typeof brightness !== 'object') return undefined;
        const fn = (brightness as Record<string, unknown>)['function'];
        return typeof fn === 'string' && fn.length > 0 ? fn : undefined;
    }

    protected sendPower(fixture: ConfiguredFixture, bus: NeewerBus, on: boolean): void {
        void bus.send(fixture, on ? NeewerProtocol.powerOn() : NeewerProtocol.powerOff());
    }
}
