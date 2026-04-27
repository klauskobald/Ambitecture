class ConfigHandler {
    constructor(renderer, config) {
        this.renderer = renderer;
        this.drawConfig = config.FIXTURE_DRAW;
        this.fixtures = [];
        this.zones = [];
        this.fixtureClasses = {
            dmx_light_static: DmxLightStatic,
        };
    }

    handle(message) {
        if (!Array.isArray(message.payload?.zones)) {
            console.warn('[config] invalid payload — expected { zones: [] }');
            return;
        }

        this.renderer.setSpatialFromZones(message.payload.zones);

        this.fixtures = [];
        this.zones = [];

        for (const zone of message.payload.zones) {
            const bbox = zone.boundingBox;
            const zoneFixtures = [];

            for (const fixtureData of zone.fixtures) {
                const { fixtureProfile, name, location, params, range, target, rotation } = fixtureData;
                const FixtureClass = this.fixtureClasses[fixtureProfile.class];
                if (!FixtureClass) {
                    console.warn(`[config] unknown fixture class: ${fixtureProfile.class}`);
                    continue;
                }
                const worldLocation = [
                    bbox[0] + location[0],
                    bbox[1] + location[1],
                    bbox[2] + location[2],
                ];
                const instanceConfig = { name, location: worldLocation, params, range, target, rotation };
                const instance = new FixtureClass(fixtureProfile, instanceConfig, this.drawConfig);
                this.fixtures.push(instance);
                zoneFixtures.push(instance);
            }

            this.zones.push({ bbox, fixtures: zoneFixtures });
        }

        this.renderer.setFixtures(this.fixtures);
        console.log(`[config] ${this.fixtures.length} fixture(s) across ${this.zones.length} zone(s)`);
    }

    getFixtures() {
        return this.fixtures;
    }

    getZones() {
        return this.zones;
    }
}
