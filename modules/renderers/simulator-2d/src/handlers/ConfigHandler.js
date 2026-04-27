class ConfigHandler {
    constructor(renderer) {
        this.renderer = renderer;
        this.fixtures = [];
    }

    handle(message) {
        if (!Array.isArray(message.payload?.zones)) {
            console.warn('[config] invalid payload — expected { zones: [] }');
            return;
        }

        this.fixtures = [];
        for (const zone of message.payload.zones) {
            for (const fixture of zone.fixtures) {
                this.fixtures.push({
                    ...fixture,
                    currentColor:      null,
                    _rawColor:         null,
                    _masterBrightness: 1,
                    _masterBlackout:   false,
                    _strobe:           0,
                });
            }
        }

        this.renderer.setFixtures(this.fixtures);
        console.log(`[config] ${this.fixtures.length} fixture(s) across ${message.payload.zones.length} zone(s)`);
    }

    getFixtures() {
        return this.fixtures;
    }
}
