import WebSocket from 'ws';
import { Logger } from '../Logger';
import { Color } from '../color';
import { DmxUniverse } from '../DmxUniverse';
import { ConfigHandler, ConfiguredFixture } from './ConfigHandler';
import { EventQueue } from '../EventQueue';

interface WsMessage {
    type: string;
    location?: [number, number];
    payload?: unknown;
}

interface LightEventColor {
    x: number;
    y: number;
    Y: number;
}

interface LightEventParams {
    color?: LightEventColor;
    layer?: number;
    blend?: string;
    alpha?: number;
}

interface LightEvent {
    class: string;
    scheduled?: number;
    position?: [number, number, number];
    params?: LightEventParams;
}

export class EventsHandler {
    private configHandler: ConfigHandler;
    private dmxUniverse: DmxUniverse;
    private queue: EventQueue<LightEvent>;

    constructor(configHandler: ConfigHandler, dmxUniverse: DmxUniverse) {
        this.configHandler = configHandler;
        this.dmxUniverse = dmxUniverse;
        this.queue = new EventQueue<LightEvent>((event) => this.processEvent(event));
    }

    handle(_ws: WebSocket, message: WsMessage): void {
        const events = message.payload as LightEvent[];
        if (!Array.isArray(events)) return;

        for (const event of events) {
            this.queue.enqueue(event);
        }

        Logger.debug(`[events] queued ${events.length} event(s)`);
    }

    private processEvent(event: LightEvent): void {
        if (event.class !== 'light') return;
        const colorData = event.params?.color;
        if (!colorData) return;

        const fixtures = this.configHandler.getFixtures();
        if (fixtures.length === 0) {
            Logger.warn('[events] no fixtures configured yet, dropping event');
            return;
        }

        const color = new Color(colorData.x, colorData.y, colorData.Y);
        const { r, g, b } = color.toRGB();

        for (const fixture of fixtures) {
            this.writeColorToFixture(fixture, r, g, b, colorData.Y);
        }
    }

    private writeColorToFixture(fixture: ConfiguredFixture, r: number, g: number, b: number, Y: number): void {
        const channelMap = fixture.fixtureProfile.params.dmx;
        for (const [offsetStr, channelDef] of Object.entries(channelMap)) {
            const offset = parseInt(offsetStr, 10);
            const dmxChannel = fixture.dmxBaseChannel + offset;

            switch (channelDef.function) {
                case 'red':
                    this.dmxUniverse.setChannel(dmxChannel, r);
                    break;
                case 'green':
                    this.dmxUniverse.setChannel(dmxChannel, g);
                    break;
                case 'blue':
                    this.dmxUniverse.setChannel(dmxChannel, b);
                    break;
                case 'brightness':
                    this.dmxUniverse.setChannel(dmxChannel, Math.round(Y * 255));
                    break;
            }
        }
    }
}
