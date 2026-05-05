import WebSocket from 'ws';
import { Logger } from '../Logger';
import { DmxUniverse } from '../DmxUniverse';
import type { IFixtureClass } from '../fixtures/IFixtureClass';

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
    /** Resolved synchronously from `fixtureProfile.class` when config is applied. */
    fixtureClass: IFixtureClass;
}

/** Parsed YAML fixture row before `fixtureClass` is attached in {@link ConfigHandler.handle}. */
export type ConfiguredFixtureDraft = Omit<ConfiguredFixture, 'fixtureClass'>;

export interface ConfiguredZone {
    name: string;
    boundingBox: [number, number, number, number, number, number];
    extend: number;
    fixtures: ConfiguredFixture[];
}

interface ConfigPayload {
    zones: unknown[];
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

function isTuple6(v: unknown): v is [number, number, number, number, number, number] {
    return (
        Array.isArray(v) &&
        v.length === 6 &&
        v.every((x) => typeof x === 'number' && Number.isFinite(x as number))
    );
}

function parseConfiguredFixture(raw: unknown, zoneName: string): ConfiguredFixtureDraft | null {
    if (!raw || typeof raw !== 'object') {
        Logger.warn(`[config] invalid fixture entry in zone "${zoneName}"`);
        return null;
    }
    const o = raw as Record<string, unknown>;
    if (typeof o['name'] !== 'string') {
        Logger.warn(`[config] fixture in zone "${zoneName}" missing name`);
        return null;
    }
    const fp = o['fixtureProfile'];
    if (!fp || typeof fp !== 'object') {
        Logger.warn(`[config] fixture "${o['name']}" missing fixtureProfile`);
        return null;
    }
    if (!isTuple3(o['location'])) {
        Logger.warn(`[config] fixture "${o['name']}" invalid location`);
        return null;
    }
    if (typeof o['range'] !== 'number' || !Number.isFinite(o['range'])) {
        Logger.warn(`[config] fixture "${o['name']}" invalid range`);
        return null;
    }
    let params: Record<string, unknown> = {};
    if (o['params'] && typeof o['params'] === 'object' && !Array.isArray(o['params'])) {
        params = { ...(o['params'] as Record<string, unknown>) };
    }
    const out: ConfiguredFixtureDraft = {
        name: o['name'],
        fixtureProfile: fp as FixtureProfile,
        location: o['location'],
        range: o['range'],
        params,
    };
    if (o['target'] !== undefined && isTuple3(o['target'])) {
        out.target = o['target'];
    }
    if (o['rotation'] !== undefined && isTuple3(o['rotation'])) {
        out.rotation = o['rotation'];
    }
    return out;
}

function loadFixtureClass(className: string): IFixtureClass | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
        const mod = require(`../fixtures/${className}`) as { default?: IFixtureClass };
        return mod.default ?? null;
    } catch {
        return null;
    }
}

interface ConfiguredZoneDraft {
    name: string;
    boundingBox: [number, number, number, number, number, number];
    extend: number;
    fixtures: ConfiguredFixtureDraft[];
}

function parseConfiguredZone(raw: unknown): ConfiguredZoneDraft | null {
    if (!raw || typeof raw !== 'object') {
        Logger.warn('[config] invalid zone entry');
        return null;
    }
    const o = raw as Record<string, unknown>;
    if (typeof o['name'] !== 'string') {
        Logger.warn('[config] zone missing name');
        return null;
    }
    if (!isTuple6(o['boundingBox'])) {
        Logger.warn(`[config] zone "${o['name']}" missing or invalid boundingBox`);
        return null;
    }
    const fixtureArr = Array.isArray(o['fixtures']) ? o['fixtures'] : [];
    const fixtures = fixtureArr
        .map((f) => parseConfiguredFixture(f, o['name'] as string))
        .filter((f): f is ConfiguredFixture => f !== null);
    const extend = typeof o['extend'] === 'number' && Number.isFinite(o['extend']) ? o['extend'] : 1;
    return { name: o['name'], boundingBox: o['boundingBox'], extend, fixtures };
}

function resolveZoneDrafts(drafts: ConfiguredZoneDraft[]): ConfiguredZone[] {
    const out: ConfiguredZone[] = [];
    for (const z of drafts) {
        const fixtures: ConfiguredFixture[] = [];
        for (const f of z.fixtures) {
            const fixtureClass = loadFixtureClass(f.fixtureProfile.class);
            if (!fixtureClass) {
                Logger.warn(`[config] unknown fixture class: ${f.fixtureProfile.class} ("${f.name}" in zone "${z.name}")`);
                continue;
            }
            fixtures.push({ ...f, fixtureClass });
        }
        out.push({
            name: z.name,
            boundingBox: z.boundingBox,
            extend: z.extend,
            fixtures,
        });
    }
    return out;
}

export class ConfigHandler {
    private zones: ConfiguredZone[] = [];
    private dmxUniverse: DmxUniverse;
    private onConfigApplied: (() => void) | null = null;

    constructor(dmxUniverse: DmxUniverse) {
        this.dmxUniverse = dmxUniverse;
    }

    setOnConfigApplied(callback: () => void): void {
        this.onConfigApplied = callback;
    }

    handle(_ws: WebSocket, message: WsMessage): void {
        if (!isConfigPayload(message.payload)) {
            Logger.warn('[config] invalid payload — expected { zones: [] }');
            return;
        }

        const zoneDrafts = message.payload.zones
            .map((z) => parseConfiguredZone(z))
            .filter((z): z is ConfiguredZoneDraft => z !== null);

        this.zones = resolveZoneDrafts(zoneDrafts);

        const fixtureCount = this.zones.reduce((n, z) => n + z.fixtures.length, 0);
        Logger.info(`[config] ${fixtureCount} fixture(s) across ${this.zones.length} zone(s)`);

        if (!this.dmxUniverse.isInitialized) {
            this.dmxUniverse.initialize();
        }
        if (this.onConfigApplied) {
            this.onConfigApplied();
        }
    }

    getZones(): ConfiguredZone[] {
        return this.zones;
    }
}
