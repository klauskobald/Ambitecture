import WebSocket from 'ws';
import { Logger } from '../Logger';
import { Color } from '../color';
import { DmxUniverse } from '../DmxUniverse';
import { ConfigHandler, ConfiguredFixture } from './ConfigHandler';

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

    constructor(configHandler: ConfigHandler, dmxUniverse: DmxUniverse) {
        this.configHandler = configHandler;
        this.dmxUniverse = dmxUniverse;
    }

    handle(_ws: WebSocket, message: WsMessage): void {
        const events = message.payload as LightEvent[];
        if (!Array.isArray(events)) return;

        const fixtures = this.configHandler.getFixtures();
        if (fixtures.length === 0) {
            Logger.warn('[events] no fixtures configured yet, ignoring event');
            return;
        }

        for (const event of events) {
            if (event.class !== 'light') continue;
            const colorData = event.params?.color;
            if (!colorData) continue;

            const color = new Color(colorData.x, colorData.y, colorData.Y);
            const { r, g, b } = color.toRGB();

            for (const fixture of fixtures) {
                this.writeColorToFixture(fixture, r, g, b, colorData.Y);
            }
        }

        Logger.debug(`[events] ${events.length} event(s) → ${fixtures.length} fixture(s)`);
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
