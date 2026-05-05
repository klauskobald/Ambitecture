import WebSocket from 'ws';
import { Logger } from '../Logger';
import { DmxUniverse } from '../DmxUniverse';
import { ConfigHandler, ConfiguredFixture, ConfiguredZone } from './ConfigHandler';
import { EventQueue } from '../EventQueue';
import { FixtureIntentSnapshot, RendererEvent } from '../fixtures/IFixtureClass';
import { FixtureSampleContext, LayerIntentEngine } from '../layerIntent/LayerIntentEngine';

interface WsMessage {
    type: string;
    location?: [number, number];
    payload?: unknown;
}

function fixtureWorldPosition(
    fixture: ConfiguredFixture,
    bbox: [number, number, number, number, number, number]
): [number, number, number] {
    return [bbox[0] + fixture.location[0], bbox[1] + fixture.location[1], bbox[2] + fixture.location[2]];
}

export class EventsHandler {
    private configHandler: ConfigHandler;
    private dmxUniverse: DmxUniverse;
    private queue: EventQueue<RendererEvent>;
    private layerIntentEngine = new LayerIntentEngine();

    constructor(configHandler: ConfigHandler, dmxUniverse: DmxUniverse) {
        this.configHandler = configHandler;
        this.dmxUniverse = dmxUniverse;
        this.queue = new EventQueue<RendererEvent>((events) => this.processBatch(events));
    }

    handle(_ws: WebSocket, message: WsMessage): void {
        const events = message.payload as RendererEvent[];
        if (!Array.isArray(events)) return;

        this.queue.enqueue(events);

        Logger.debug(`[events] queued ${events.length} event(s)`);
    }

    reapplyCurrentIntents(): void {
        const zones = this.configHandler.getZones();
        if (zones.length === 0) {
            return;
        }
        this.applyAllFixtures(zones);
    }

    private processBatch(events: RendererEvent[]): void {
        const zones = this.configHandler.getZones();
        if (zones.length === 0) {
            Logger.warn('[events] no zones configured yet, dropping event batch');
            return;
        }

        let anyChanged = false;
        for (const event of events) {
            const changed = this.layerIntentEngine.applyEvent(event, zones);
            if (changed) {
                anyChanged = true;
            } else if (event.position) {
                Logger.debug(`[events] position [${event.position.join(', ')}] matched no zones`);
            }
        }

        if (!anyChanged) {
            return;
        }

        this.applyAllFixtures(zones);
    }

    private applyAllFixtures(zones: ConfiguredZone[]): void {
        const intentsByLayer = this.layerIntentEngine.getActiveIntents();
        for (const zone of zones) {
            for (const fixture of zone.fixtures) {
                const worldPos = fixtureWorldPosition(fixture, zone.boundingBox);
                const context: FixtureSampleContext = {
                    fixture,
                    fixtureWorldPos: worldPos,
                    zoneName: zone.name,
                };
                const snapshot: FixtureIntentSnapshot = {
                    intentsByLayer,
                    sample: <TValue>(capabilityKey: string, withSpatialFactor?: boolean) => this.layerIntentEngine.sample<TValue>(context, capabilityKey, withSpatialFactor),
                };
                fixture.fixtureClass.applyIntentSnapshot(fixture, context, snapshot, this.dmxUniverse);
            }
        }
        this.dmxUniverse.flushNow();
    }
}
