export class AlgorithmBase {
  constructor(fixtureProfile, instanceConfig, algorithmConfig) {
    this.fixtureProfile = fixtureProfile;
    this.instanceConfig = instanceConfig;
    this.algorithmConfig = algorithmConfig;
  }

  update(_nowSec) {}

  apply(_snapshot, _context) {
    throw new Error(`${this.constructor.name} must implement apply()`);
  }

  draw(_ctx, _w, _h, _nowSec) {
    throw new Error(`${this.constructor.name} must implement draw()`);
  }
}
