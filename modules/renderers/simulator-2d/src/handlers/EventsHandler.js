class EventsHandler {
    constructor(configHandler) {
        this.configHandler = configHandler;
        this.queue = new EventQueue(event => this.processEvent(event));
        this.fixtureClasses = {
            dmx_light_static: DmxLightStatic,
        };
    }

    handle(message) {
        const events = message.payload;
        if (!Array.isArray(events)) return;
        for (const event of events) this.queue.enqueue(event);
    }

    processEvent(event) {
        const fixtures = this.configHandler.getFixtures();
        if (fixtures.length === 0) {
            console.warn('[events] no fixtures configured yet, dropping event');
            return;
        }
        for (const fixture of fixtures) {
            const handler = this.fixtureClasses[fixture.fixtureProfile.class];
            if (handler) handler.handleEvent(event, fixture);
        }
    }
}
