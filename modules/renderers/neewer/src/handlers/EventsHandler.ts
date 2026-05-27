import WebSocket from 'ws';
import { Logger } from '../Logger';
import { NeewerBus } from '../NeewerBus';
import { ConfigHandler, ConfiguredFixture, ConfiguredZone } from './ConfigHandler';
import { EventQueue } from '../EventQueue';
import { FixtureIntentSnapshot, RendererEvent } from '../fixtures/IFixtureClass';
import { FixtureSampleContext, LayerIntentEngine } from '../layerIntent/LayerIntentEngine';
import { strobeRegistry } from '../StrobeRegistry';

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
    private neewerBus: NeewerBus;
    private queue: EventQueue<RendererEvent>;
    private layerIntentEngine = new LayerIntentEngine();

    constructor(configHandler: ConfigHandler, neewerBus: NeewerBus) {
        this.configHandler = configHandler;
        this.neewerBus = neewerBus;
        this.queue = new EventQueue<RendererEvent>((events) => this.processBatch(events));
    }

    handle(_ws: WebSocket, message: WsMessage): void {
        const events = message.payload as RendererEvent[];
        if (!Array.isArray(events)) return;
        this.queue.enqueue(events);
    }

    reapplyCurrentIntents(): void {
        // A fresh config may change strobe params or drop fixtures; tear every timer down and
        // let applyAllFixtures re-arm the ones still strobing with their current config.
        strobeRegistry.stopAll();
        const zones = this.configHandler.getZones();
        if (zones.length === 0) return;
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
            if (changed) anyChanged = true;
        }
        if (!anyChanged) return;
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
                fixture.fixtureClass.applyIntentSnapshot(fixture, context, snapshot, this.neewerBus);
            }
        }
    }
}
