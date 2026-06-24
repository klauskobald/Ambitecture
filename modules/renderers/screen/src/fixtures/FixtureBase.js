export class FixtureBase {
  constructor(profile, instanceConfig) {
    this.guid =
      typeof instanceConfig.guid === 'string' && instanceConfig.guid.trim() !== ''
        ? instanceConfig.guid.trim()
        : null;
    this.name = instanceConfig.name;
    this.location = instanceConfig.location;
    this.range = instanceConfig.range;
    this.params = instanceConfig.params ?? {};
    this.fixtureProfile = profile;
  }

  update(_nowSec) {}

  /**
   * Effective `power.sleepOnBlackout`: per-instance override (`params.power.sleepOnBlackout`)
   * falling back to the profile default (`fixtureProfile.params.power.sleepOnBlackout`). When on
   * and the resolved output has settled at 0, the fixture stops refreshing its pixel.
   * @returns {boolean}
   */
  sleepOnBlackoutEnabled() {
    const instance = readPowerSleep(this.params);
    if (instance !== undefined) return instance;
    return readPowerSleep(this.fixtureProfile?.params) ?? false;
  }

  applyIntentSnapshot(_context, _snapshot) {
    throw new Error(`${this.constructor.name} must implement applyIntentSnapshot()`);
  }

  draw(_ctx, _w, _h, _nowSec) {
    throw new Error(`${this.constructor.name} must implement draw()`);
  }
}

/** Read `power.sleepOnBlackout` from a `params`-shaped bag; undefined when the key is absent. */
function readPowerSleep(params) {
  const power = params?.power;
  if (!power || typeof power !== 'object' || Array.isArray(power)) return undefined;
  const v = power.sleepOnBlackout;
  return typeof v === 'boolean' ? v : undefined;
}
