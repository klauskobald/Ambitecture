import WebSocket from 'ws';
import { Logger } from '../Logger';
import { DmxUniverse } from '../DmxUniverse';
import { ConfigHandler, ConfiguredFixture, ConfiguredZone } from './ConfigHandler';
import { EventQueue } from '../EventQueue';
import { IFixtureClass, RendererEvent } from '../fixtures/IFixtureClass';
import { Vector3 } from '../Vector3';

interface WsMessage {
    type: string;
    location?: [number, number];
    payload?: unknown;
}

function isPositionInZone(
    pos: [number, number, number],
    bbox: [number, number, number, number, number, number]
): boolean {
    return pos[0] >= bbox[0] && pos[0] <= bbox[3]
        && pos[1] >= bbox[1] && pos[1] <= bbox[4]
        && pos[2] >= bbox[2] && pos[2] <= bbox[5];
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

        const eventPos = event.position;

        if (!eventPos) {
            await this.broadcastToAllFixtures(event, zones);
            return;
        }

        await this.dispatchToZoneFixtures(event, eventPos, zones);
    }

    private async broadcastToAllFixtures(event: RendererEvent, zones: ConfiguredZone[]): Promise<void> {
        for (const zone of zones) {
            for (const fixture of zone.fixtures) {
                const handler = await this.getFixtureClass(fixture.fixtureProfile.class);
                handler.handleEvent(event, fixture, this.dmxUniverse, null);
            }
        }
    }

    private async dispatchToZoneFixtures(
        event: RendererEvent,
        eventPos: [number, number, number],
        zones: ConfiguredZone[]
    ): Promise<void> {
        let dispatched = 0;
        for (const zone of zones) {
            if (!isPositionInZone(eventPos, zone.boundingBox)) continue;
            for (const fixture of zone.fixtures) {
                const worldPos = fixtureWorldPosition(fixture, zone.boundingBox);
                const spatial = Vector3.fromTo(worldPos, eventPos);
                const handler = await this.getFixtureClass(fixture.fixtureProfile.class);
                handler.handleEvent(event, fixture, this.dmxUniverse, spatial);
                dispatched++;
            }
        }
        if (dispatched === 0) {
            Logger.debug(`[events] position [${eventPos.join(', ')}] matched no zones`);
        }
    }
}
