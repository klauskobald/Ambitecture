import WebSocket from 'ws';
import { Logger } from '../Logger';
import { DmxUniverse } from '../DmxUniverse';

interface WsMessage {
    type: string;
    location?: [number, number];
    payload?: unknown;
}

export interface FixtureChannelDef {
    function: string;
    range: string;
}

export interface FixtureProfile {
    name: string;
    class: string;
    params: {
        dmx: Record<string, FixtureChannelDef[]>;
    };
}

export interface ConfiguredFixture {
    name: string;
    fixtureProfile: FixtureProfile;
    dmxBaseChannel: number;
    location: [number, number, number];
    range: number;
}

interface ConfigPayload {
    zones: Array<{
        name: string;
        fixtures: ConfiguredFixture[];
    }>;
}

function isConfigPayload(payload: unknown): payload is ConfigPayload {
    if (!payload || typeof payload !== 'object') return false;
    return Array.isArray((payload as Record<string, unknown>)['zones']);
}

export class ConfigHandler {
    private fixtures: ConfiguredFixture[] = [];
    private dmxUniverse: DmxUniverse;

    constructor(dmxUniverse: DmxUniverse) {
        this.dmxUniverse = dmxUniverse;
    }

    handle(_ws: WebSocket, message: WsMessage): void {
        if (!isConfigPayload(message.payload)) {
            Logger.warn('[config] invalid payload — expected { zones: [] }');
            return;
        }

        this.fixtures = [];
        for (const zone of message.payload.zones) {
            for (const fixture of zone.fixtures) {
                this.fixtures.push(fixture);
            }
        }

        Logger.info(`[config] ${this.fixtures.length} fixture(s) across ${message.payload.zones.length} zone(s)`);

        if (!this.dmxUniverse.isInitialized) {
            this.dmxUniverse.initialize();
        }
    }

    getFixtures(): ConfiguredFixture[] {
        return this.fixtures;
    }
}
