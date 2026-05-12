import { createFixture } from '../fixtures/registry.js';

export class ConfigHandler {
  /**
   * @param {import('../ScreenRenderer.js').ScreenRenderer} screenRenderer
   */
  constructor(screenRenderer) {
    this.renderer = screenRenderer;
    this.fixtures = [];
    this.zones = [];
    this.onConfigApplied = null;
  }

  setOnConfigApplied(callback) {
    this.onConfigApplied = callback;
  }

  handle(payload) {
    if (!Array.isArray(payload?.zones)) {
      console.warn('[config] invalid payload — expected { zones: [] }');
      return;
    }

    this.fixtures = [];
    this.zones = [];

    for (const zone of payload.zones) {
      const bbox = zone.boundingBox;
      const extend =
        typeof zone.extend === 'number' && Number.isFinite(zone.extend)
          ? zone.extend
          : 1;
      const zoneName = typeof zone.name === 'string' ? zone.name : '';
      const zoneFixtures = [];

      for (const fixtureData of zone.fixtures) {
        const {
          fixtureProfile,
          name,
          location,
          params,
          range,
          target,
          rotation
        } = fixtureData;
        const instance = createFixture(fixtureProfile.class, fixtureProfile, {
          name,
          location: [
            bbox[0] + location[0],
            bbox[1] + location[1],
            bbox[2] + location[2]
          ],
          params,
          range,
          target,
          rotation
        });
        if (!instance) {
          console.warn(
            `[config] will not handle fixture class: ${fixtureProfile.class}`
          );
          continue;
        }
        this.fixtures.push(instance);
        zoneFixtures.push(instance);
      }

      this.zones.push({ name: zoneName, bbox, extend, fixtures: zoneFixtures });
    }

    this.renderer.setFixtures(this.fixtures);
    console.log(
      `[config] ${this.fixtures.length} fixture(s) across ${this.zones.length} zone(s)`
    );

    if (this.onConfigApplied) {
      this.onConfigApplied();
    }
  }

  getFixtures() {
    return this.fixtures;
  }

  getZones() {
    return this.zones;
  }
}
