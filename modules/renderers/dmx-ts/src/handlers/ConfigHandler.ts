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
    location: [number, number, number];
    range: number;
    /** Class-specific instance binding (e.g. `dmxBaseChannel` for DMX fixtures). */
    params: Record<string, unknown>;
    target?: [number, number, number];
    rotation?: [number, number, number];
}

interface ConfigPayload {
    zones: Array<{
        name: string;
        fixtures: unknown[];
    }>;
}

function isConfigPayload(payload: unknown): payload is ConfigPayload {
    if (!payload || typeof payload !== 'object') return false;
    return Array.isArray((payload as Record<string, unknown>)['zones']);
}

function isTuple3(v: unknown): v is [number, number, number] {
    return (
        Array.isArray(v) &&
        v.length === 3 &&
        v.every((x) => typeof x === 'number' && Number.isFinite(x as number))
    );
}

function parseConfiguredFixture(raw: unknown, zoneName: string): ConfiguredFixture | null {
    if (!raw || typeof raw !== 'object') {
        Logger.warn(`[config] invalid fixture entry in zone "${zoneName}"`);
        return null;
    }
    const o = raw as Record<string, unknown>;
    if (typeof o.name !== 'string') {
        Logger.warn(`[config] fixture in zone "${zoneName}" missing name`);
        return null;
    }
    const fp = o.fixtureProfile;
    if (!fp || typeof fp !== 'object') {
        Logger.warn(`[config] fixture "${o.name}" missing fixtureProfile`);
        return null;
    }
    if (!isTuple3(o.location)) {
        Logger.warn(`[config] fixture "${o.name}" invalid location`);
        return null;
    }
    if (typeof o.range !== 'number' || !Number.isFinite(o.range)) {
        Logger.warn(`[config] fixture "${o.name}" invalid range`);
        return null;
    }
    let params: Record<string, unknown> = {};
    if (o.params && typeof o.params === 'object' && !Array.isArray(o.params)) {
        params = { ...(o.params as Record<string, unknown>) };
    }
    const out: ConfiguredFixture = {
        name: o.name,
        fixtureProfile: fp as FixtureProfile,
        location: o.location,
        range: o.range,
        params,
    };
    if (o.target !== undefined && isTuple3(o.target)) {
        out.target = o.target;
    }
    if (o.rotation !== undefined && isTuple3(o.rotation)) {
        out.rotation = o.rotation;
    }
    return out;
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
            for (const rawFixture of zone.fixtures) {
                const parsed = parseConfiguredFixture(rawFixture, zone.name);
                if (parsed) {
                    this.fixtures.push(parsed);
                }
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
