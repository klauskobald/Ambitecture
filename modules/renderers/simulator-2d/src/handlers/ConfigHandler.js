class ConfigHandler {
    constructor(renderer, config) {
        this.renderer = renderer;
        this.drawConfig = config.FIXTURE_DRAW;
        this.fixtures = [];
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
        for (const zone of message.payload.zones) {
            for (const fixtureData of zone.fixtures) {
                const { fixtureProfile, name, location, params, range, target, rotation } = fixtureData;
                const FixtureClass = this.fixtureClasses[fixtureProfile.class];
                if (!FixtureClass) {
                    console.warn(`[config] unknown fixture class: ${fixtureProfile.class}`);
                    continue;
                }
                const instanceConfig = { name, location, params, range, target, rotation };
                this.fixtures.push(new FixtureClass(fixtureProfile, instanceConfig, this.drawConfig));
            }
        }

        this.renderer.setFixtures(this.fixtures);
        console.log(`[config] ${this.fixtures.length} fixture(s) across ${message.payload.zones.length} zone(s)`);
    }

    getFixtures() {
        return this.fixtures;
    }
}
