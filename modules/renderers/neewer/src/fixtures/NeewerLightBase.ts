import { ConfiguredFixture } from '../handlers/ConfigHandler';
import { NeewerBus } from '../NeewerBus';
import { FixtureSampleContext, FixtureIntentSnapshot, IFixtureClass } from './IFixtureClass';
import * as NeewerProtocol from '../ble/NeewerProtocol';
import { FnCurve } from '../FnCurve';
import { evaluateNeewerHue } from '../neewerHue';
import { strobeRegistry } from '../StrobeRegistry';
import { parseStrobeConfig } from '../StrobeScheduler';

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
        bus.setHsv(fixture, this.curveHue(fixture, hue), sat, this.curveBrightness(fixture, bri));
    }

    // Strobe is simulated by gating brightness on a timer (the lamp has no strobe channel).
    // bri is 0–100; strobeValue is 0–1. While the light is dark anyway (bri 0) there is
    // nothing to flash, so we fall back to a single steady write and keep the BLE bus quiet.
    protected sendHsvStrobed(
        fixture: ConfiguredFixture,
        bus: NeewerBus,
        hue: number,
        sat: number,
        bri: number,
        strobeValue: number
    ): void {
        const wantsStrobe = strobeValue > 0 && bri > 0;
        if (!wantsStrobe) {
            strobeRegistry.release(fixture.name);
            this.sendHsv(fixture, bus, hue, sat, bri);
            return;
        }
        const scheduler = strobeRegistry.acquire(
            fixture.name,
            () => parseStrobeConfig(fixture.fixtureProfile.params['strobe'])
        );
        scheduler.update(hue, sat, bri, strobeValue, (h, s, b) => this.sendHsv(fixture, bus, h, s, b));
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
        return this.getChannelFunction(fixture, 'brightness');
    }

    // Neewer HSV hue is compressed around yellow; the hue channel function bends
    // perceptual hue (from rgbToHsv01) before BLE send. hue is 0–360 degrees.
    private curveHue(fixture: ConfiguredFixture, hue: number): number {
        const fn = this.getHueFunction(fixture);
        if (fn === undefined) return hue;
        return evaluateNeewerHue(fn, hue);
    }

    private getHueFunction(fixture: ConfiguredFixture): string | undefined {
        return this.getChannelFunction(fixture, 'hue');
    }

    private getChannelFunction(fixture: ConfiguredFixture, channel: string): string | undefined {
        const channels = fixture.fixtureProfile.params['channels'];
        if (!channels || typeof channels !== 'object') return undefined;
        const entry = (channels as Record<string, unknown>)[channel];
        if (!entry || typeof entry !== 'object') return undefined;
        const fn = (entry as Record<string, unknown>)['function'];
        return typeof fn === 'string' && fn.length > 0 ? fn : undefined;
    }

    protected sendPower(fixture: ConfiguredFixture, bus: NeewerBus, on: boolean): void {
        void bus.send(fixture, on ? NeewerProtocol.powerOn() : NeewerProtocol.powerOff());
    }
}
