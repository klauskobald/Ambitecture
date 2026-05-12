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
    this.algorithm.apply(snapshot, context);
  }

  draw(ctx, w, h, nowSec) {
    this.algorithm.draw(ctx, w, h, nowSec);
  }
}
