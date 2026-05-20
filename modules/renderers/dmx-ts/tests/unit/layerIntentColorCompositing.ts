/**
 * Same-layer ALPHA peers add (ADD), then composite over lower layers (ALPHA).
 * Run: `npm run test:layer-intent-color` from modules/renderers/dmx-ts
 */
import { Color } from '../../src/color';
import { LayerIntentEngine } from '../../src/layerIntent/LayerIntentEngine';
import type { ConfiguredFixture, ConfiguredZone } from '../../src/handlers/ConfigHandler';
import type { RendererEvent } from '../../src/fixtures/IFixtureClass';

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        throw new Error(msg);
    }
}

const RED = { x: 0.64, y: 0.33, Y: 1 };
const GREEN = { x: 0.3, y: 0.6, Y: 1 };
const BLUE = { x: 0.15, y: 0.06, Y: 1 };

const DUMMY_ZONE: ConfiguredZone = {
    name: 'test',
    boundingBox: [0, 0, 0, 10, 10, 10],
    extend: 0,
    fixtures: [],
};

const FIXTURE: ConfiguredFixture = {
    name: 'f1',
    fixtureProfile: {
        name: 'test',
        class: 'dmx_light_static',
        params: { dmx: {} },
    },
    location: [5, 5, 0],
    range: 10,
    params: {},
    fixtureClass: {} as ConfiguredFixture['fixtureClass'],
};

function lightEvent(
    guid: string,
    layer: number,
    color: { x: number; y: number; Y: number },
    blend: 'ALPHA' | 'ADD' = 'ALPHA',
): RendererEvent {
    return {
        guid,
        class: 'light',
        layer,
        params: { color, blend, alpha: 1 },
    };
}

function xyDistance(
    a: { x: number; y: number },
    b: { x: number; y: number },
): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function main(): void {
    const engine = new LayerIntentEngine();
    const context = {
        fixture: FIXTURE,
        fixtureWorldPos: FIXTURE.location,
        zoneName: 'test',
    };

    engine.applyEvent(lightEvent('blue', 100, BLUE), [DUMMY_ZONE]);
    engine.applyEvent(lightEvent('red', 150, RED), [DUMMY_ZONE]);
    engine.applyEvent(lightEvent('green', 150, GREEN), [DUMMY_ZONE]);

    const mixed = engine.sample<Color>(context, 'light.color.xyY', false);
    assert(mixed !== undefined, 'expected mixed color');

    const { r, g, b } = mixed!.toRGB();
    assert(r > 0.85 && g > 0.85 && b < 0.15, `expected yellow RGB, got r=${r} g=${g} b=${b}`);

    const engineHsl = new LayerIntentEngine();
    const hslRed = { x: 0.64, y: 0.33, Y: 0.2127 };
    const hslGreen = { x: 0.3, y: 0.6, Y: 0.7152 };
    engineHsl.applyEvent(lightEvent('hsl-red', 150, hslRed), [DUMMY_ZONE]);
    engineHsl.applyEvent(lightEvent('hsl-green', 150, hslGreen), [DUMMY_ZONE]);
    const hslMix = engineHsl.sample<Color>(context, 'light.color.xyY', false);
    assert(hslMix !== undefined, 'expected HSL-weighted peer mix');
    const hslRgb = hslMix!.toRGB();
    assert(
        hslRgb.r > 0.85 && hslRgb.g > 0.85,
        `HSL red+green peers should balance in linear RGB (r=${hslRgb.r} g=${hslRgb.g} b=${hslRgb.b})`,
    );

    console.log('layerIntentColorCompositing: ok');
}

main();
