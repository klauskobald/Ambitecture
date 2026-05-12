import { AlgorithmBase } from './AlgorithmBase.js';
import { Color } from '../color.js';

export class SinglePixelAlgorithm extends AlgorithmBase {
  constructor(fixtureProfile, instanceConfig, algorithmConfig) {
    super(fixtureProfile, instanceConfig, algorithmConfig);
    this._rgb = { r: 0, g: 0, b: 0 };
  }

  apply(snapshot, _context) {
    const xbrightness = 1;
    const withSpatial = true;

    const color =
      snapshot.sample('light.color.xyY', withSpatial) || Color.black();
    const masterBrightness = snapshot.sample('master.brightness') ?? 1;
    const boostBrightness = masterBrightness > 1 ? masterBrightness : 1;
    const masterBlackout = snapshot.sample('master.blackout') ?? false;

    const { r, g, b } = color.toRGB();
    const f =
      Math.max(0, Math.min(1, xbrightness * masterBrightness)) *
      (masterBlackout ? 0 : 1) *
      boostBrightness;
    this._rgb = { r: r * f, g: g * f, b: b * f };
  }

  draw(ctx, w, h, _nowSec) {
    const c = this._rgb;
    ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
    ctx.fillRect(0, 0, w, h);
  }
}
