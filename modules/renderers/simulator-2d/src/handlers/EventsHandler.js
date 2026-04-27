function isPositionInZone(pos, bbox) {
    return pos[0] >= bbox[0] && pos[0] <= bbox[3]
        && pos[1] >= bbox[1] && pos[1] <= bbox[4]
        && pos[2] >= bbox[2] && pos[2] <= bbox[5];
}

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
        const zones = this.configHandler.getZones();
        const eventPos = event.position;

        if (!eventPos) {
            this._broadcastToAll(event, zones);
        } else {
            this._dispatchToZones(event, eventPos, zones);
        }

        this._renderer.handleEvent(event);
    }

    _broadcastToAll(event, zones) {
        for (const zone of zones) {
            for (const fixture of zone.fixtures) {
                fixture.handleEvent(event, null);
            }
        }
    }

    _dispatchToZones(event, eventPos, zones) {
        let dispatched = 0;
        for (const zone of zones) {
            if (!isPositionInZone(eventPos, zone.bbox)) continue;
            for (const fixture of zone.fixtures) {
                const spatial = Vector3.fromTo(fixture.location, eventPos);
                fixture.handleEvent(event, spatial);
                dispatched++;
            }
        }
        if (dispatched === 0) {
            console.debug(`[events] position [${eventPos.join(', ')}] matched no zones`);
        }
    }
}
