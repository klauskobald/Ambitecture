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
        for (const fixture of this.configHandler.getFixtures()) {
            fixture.handleEvent(event);
        }
        this._renderer.handleEvent(event);
    }
}
