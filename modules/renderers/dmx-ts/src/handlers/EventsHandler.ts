import WebSocket from 'ws';
import { Logger } from '../Logger';
import { DmxUniverse } from '../DmxUniverse';
import { ConfigHandler } from './ConfigHandler';
import { EventQueue } from '../EventQueue';
import { IFixtureClass, RendererEvent } from '../fixtures/IFixtureClass';

interface WsMessage {
    type: string;
    location?: [number, number];
    payload?: unknown;
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
        const fixtures = this.configHandler.getFixtures();
        if (fixtures.length === 0) {
            Logger.warn('[events] no fixtures configured yet, dropping event');
            return;
        }

        for (const fixture of fixtures) {
            const handler = await this.getFixtureClass(fixture.fixtureProfile.class);
            handler.handleEvent(event, fixture, this.dmxUniverse);
        }
    }
}
