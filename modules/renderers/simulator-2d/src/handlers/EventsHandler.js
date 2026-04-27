class EventsHandler {
    constructor(configHandler, renderer) {
        this.configHandler = configHandler;
        this._renderer = renderer;
        this.queue = new EventQueue(event => this.processEvent(event));
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
            fixture.handleEvent(event);
        }
        this._renderer.handleEvent(event);
    }
}
