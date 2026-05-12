export class FixtureBase {
  constructor(profile, instanceConfig) {
    this.name = instanceConfig.name;
    this.location = instanceConfig.location;
    this.range = instanceConfig.range;
    this.params = instanceConfig.params ?? {};
    this.fixtureProfile = profile;
  }

  update(_nowSec) {}

  applyIntentSnapshot(_context, _snapshot) {
    throw new Error(`${this.constructor.name} must implement applyIntentSnapshot()`);
  }

  draw(_ctx, _w, _h, _nowSec) {
    throw new Error(`${this.constructor.name} must implement draw()`);
  }
}
