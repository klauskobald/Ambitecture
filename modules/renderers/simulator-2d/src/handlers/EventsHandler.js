class EventsHandler {
    constructor(configHandler, renderer) {
        this.configHandler = configHandler;
        this._renderer = renderer;
        this._layerIntentEngine = new LayerIntentEngine();
        this.queue = new EventQueue(events => this.processBatch(events), () => {
            this._renderer.markRenderActivity();
        });
    }

    handle(message) {
        const events = message.payload;
        if (!Array.isArray(events)) return;
        this.queue.enqueue(events);
    }

    reapplyCurrentIntents(clearFirst = false) {
        if (clearFirst) this._layerIntentEngine.clear();
        const zones = this.configHandler.getZones();
        if (!Array.isArray(zones) || zones.length === 0) {
            return;
        }
        const intentsByLayer = this._layerIntentEngine.getActiveIntents();
        for (const zone of zones) {
            for (const fixture of zone.fixtures) {
                const context = {
                    fixture,
                    fixtureWorldPos: fixture.location,
                    zoneName: zone.name,
                };
                const snapshot = {
                    intentsByLayer,
                    sample: (capabilityKey, withSpatialFactor) => this._layerIntentEngine.sample(context, capabilityKey, withSpatialFactor),
                };
                fixture.applyIntentSnapshot(context, snapshot);
            }
        }
        this._renderer.setIntentLayers(intentsByLayer);
    }

    processBatch(events) {
        const zones = this.configHandler.getZones();
        if (!Array.isArray(zones) || zones.length === 0) {
            return;
        }
        let anyChanged = false;
        for (const event of events) {
            const changed = this._layerIntentEngine.applyEvent(event, zones);
            if (changed) {
                anyChanged = true;
            } else if (event.position) {
                console.debug(`[events] position [${event.position.join(', ')}] matched no zones`);
            }
        }
        if (!anyChanged) return;
        this.reapplyCurrentIntents();
    }
}
