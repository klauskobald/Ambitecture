class EventsHandler {
    constructor(configHandler, renderer) {
        this.configHandler = configHandler;
        this._renderer = renderer;
        this._layerIntentEngine = new LayerIntentEngine();
        this.queue = new EventQueue(event => this.processEvent(event));
    }

    handle(message) {
        const events = message.payload;
        if (!Array.isArray(events)) return;
        for (const event of events) this.queue.enqueue(event);
    }

    processEvent(event) {
        const zones = this.configHandler.getZones();
        const changed = this._layerIntentEngine.applyEvent(event, zones);
        if (!changed && event.position) {
            console.debug(`[events] position [${event.position.join(', ')}] matched no zones`);
            return;
        }

        const intentsByLayer = this._layerIntentEngine.getActiveIntentsByLayer();
        for (const zone of zones) {
            for (const fixture of zone.fixtures) {
                const context = {
                    fixture,
                    fixtureWorldPos: fixture.location,
                    zoneName: zone.name,
                };
                const snapshot = {
                    intentsByLayer,
                    sample: capabilityKey => this._layerIntentEngine.sample(context, capabilityKey),
                };
                fixture.applyIntentSnapshot(context, snapshot);
            }
        }
        this._renderer.setIntentLayers(intentsByLayer);
    }
}
