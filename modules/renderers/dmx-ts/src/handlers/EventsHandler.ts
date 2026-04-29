import WebSocket from 'ws';
import { Logger } from '../Logger';
import { DmxUniverse } from '../DmxUniverse';
import { ConfigHandler, ConfiguredFixture, ConfiguredZone } from './ConfigHandler';
import { EventQueue } from '../EventQueue';
import { FixtureIntentSnapshot, IFixtureClass, RendererEvent } from '../fixtures/IFixtureClass';
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
    private fixtureClassCache = new Map<string, IFixtureClass>();
    private layerIntentEngine = new LayerIntentEngine();

    constructor(configHandler: ConfigHandler, dmxUniverse: DmxUniverse) {
        this.configHandler = configHandler;
        this.dmxUniverse = dmxUniverse;
        this.queue = new EventQueue<RendererEvent>((event) => this.processEvent(event));
    }

    handle(_ws: WebSocket, message: WsMessage): void {
        const events = message.payload as RendererEvent[];
        if (!Array.isArray(events)) return;

        for (const event of events) {
            this.queue.enqueue(event);
        }

        Logger.debug(`[events] queued ${events.length} event(s)`);
    }

    reapplyCurrentIntents(): void {
        const zones = this.configHandler.getZones();
        if (zones.length === 0) {
            return;
        }
        void this.applyAllFixtures(zones);
    }

    private async getFixtureClass(className: string): Promise<IFixtureClass> {
        if (!this.fixtureClassCache.has(className)) {
            const mod = await import(`../fixtures/${className}`);
            this.fixtureClassCache.set(className, mod.default as IFixtureClass);
        }
        return this.fixtureClassCache.get(className)!;
    }

    private async processEvent(event: RendererEvent): Promise<void> {
        const zones = this.configHandler.getZones();
        if (zones.length === 0) {
            Logger.warn('[events] no zones configured yet, dropping event');
            return;
        }

        const changed = this.layerIntentEngine.applyEvent(event, zones);
        if (!changed && event.position) {
            Logger.debug(`[events] position [${event.position.join(', ')}] matched no zones`);
            return;
        }
        await this.applyAllFixtures(zones);
    }

    private async applyAllFixtures(zones: ConfiguredZone[]): Promise<void> {
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
                    sample: <TValue>(capabilityKey: string) => this.layerIntentEngine.sample<TValue>(context, capabilityKey),
                };
                const handler = await this.getFixtureClass(fixture.fixtureProfile.class);
                handler.applyIntentSnapshot(fixture, context, snapshot, this.dmxUniverse);
            }
        }
    }
}
