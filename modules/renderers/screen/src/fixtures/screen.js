import { createAlgorithm, isKnownAlgorithmClass } from '../algorithms/registry.js';
import { FixtureBase } from './FixtureBase.js';

export class ScreenFixture extends FixtureBase {
  constructor(profile, instanceConfig) {
    super(profile, instanceConfig);
    const raw = instanceConfig.params?.algorithm;
    const algorithmConfig =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    let algorithmClass =
      typeof algorithmConfig.class === 'string' && algorithmConfig.class.trim() !== ''
        ? algorithmConfig.class.trim()
        : 'singlePixel';
    if (!isKnownAlgorithmClass(algorithmClass)) {
      console.warn(
        `[screen] unknown algorithm "${algorithmClass}", falling back to singlePixel`
      );
      algorithmClass = 'singlePixel';
    }
    this.algorithm = createAlgorithm(
      algorithmClass,
      profile,
      instanceConfig,
      algorithmConfig
    );
  }

  update(nowSec) {
    this.algorithm.update?.(nowSec);
  }

  applyIntentSnapshot(context, snapshot) {
    const masterBrightness = snapshot.sample('master.brightness') ?? 1;
    const masterBlackout = snapshot.sample('master.blackout') ?? false;
    const resulting = Math.max(0, masterBrightness) * (masterBlackout ? 0 : 1);
    // Asleep on blackout: once the pixel has settled at 0 output, stop refreshing the algorithm.
    // The first dark frame still applies (latch flips after), so the pixel reaches black.
    const asleep = resulting === 0 && this.sleepOnBlackoutEnabled();
    const skip = asleep && this._settledDark === true;
    this._settledDark = resulting === 0;
    if (!skip) this.algorithm.apply(snapshot, context);
  }

  draw(ctx, w, h, nowSec) {
    this.algorithm.draw(ctx, w, h, nowSec);
  }
}
