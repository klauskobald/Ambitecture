import { Color } from '../color.js';

/**
 * `light.color.xyY` arrives from the hub as `[x,y,Y]`; rewrap into a Color so the algorithm classes
 * (which call `color.toRGB()`) are unchanged. Other caps pass through.
 */
function sampleFixtureCap(caps, key) {
  const v = caps[key];
  if (v === undefined) return undefined;
  if (key === 'light.color.xyY' && Array.isArray(v) && v.length === 3) {
    return new Color(v[0], v[1], v[2]);
  }
  return v;
}

/**
 * Consumes the hub's resolved per-fixture `fixtureState` stream. All resolution is hub-side; the screen
 * just composes the selected fixture's caps into a pixel (with render-time strobe gating in the draw loop).
 */
export class FixtureStateHandler {
  /**
   * @param {import('./ConfigHandler.js').ConfigHandler} configHandler
   * @param {import('../ScreenRenderer.js').ScreenRenderer} screenRenderer
   * @param {() => string | null} getSelectedScreenFixtureGuid
   */
  constructor(configHandler, screenRenderer, getSelectedScreenFixtureGuid) {
    this.configHandler = configHandler;
    this._screenRenderer = screenRenderer;
    this._getSelectedScreenFixtureGuid = getSelectedScreenFixtureGuid;
    this._caps = new Map();
  }

  handle(payload) {
    const entries = payload;
    if (!Array.isArray(entries)) return;
    for (const e of entries) {
      if (e && typeof e.fixtureGuid === 'string' && e.caps && typeof e.caps === 'object') {
        this._caps.set(e.fixtureGuid, e.caps);
      }
    }
    this.reapplyCurrentIntents();
  }

  reapplyCurrentIntents() {
    const zones = this.configHandler.getZones();
    if (!Array.isArray(zones) || zones.length === 0) {
      return;
    }
    const selectedGuid = this._getSelectedScreenFixtureGuid();
    for (const zone of zones) {
      for (const fixture of zone.fixtures) {
        const profileClass = fixture.fixtureProfile?.class;
        if (profileClass === 'screen') {
          if (!selectedGuid || fixture.guid !== selectedGuid) {
            continue;
          }
        }
        const context = {
          fixture,
          fixtureWorldPos: fixture.location,
          zoneName: zone.name
        };
        const caps = (fixture.guid && this._caps.get(fixture.guid)) || {};
        const snapshot = {
          sample: capabilityKey => sampleFixtureCap(caps, capabilityKey)
        };
        fixture.applyIntentSnapshot(context, snapshot);
      }
    }
    this._screenRenderer.markRenderActivity();
  }
}
