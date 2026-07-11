import WebSocket from 'ws';
import { Logger } from '../Logger';
import { normalizeBleAddress, type BleMatch } from '../ble/bleLookup';
import { NeewerBus } from '../NeewerBus';
import type { IFixtureClass } from '../fixtures/IFixtureClass';

interface WsMessage {
    type: string;
    location?: [number, number];
    payload?: unknown;
}

export interface FixtureProfile {
    name: string;
    class: string;
    params: Record<string, unknown>;
}

export interface ConfiguredFixture {
    /** Hub fixture GUID; used to match hub-resolved per-fixture `fixtureState` caps. */
    guid?: string;
    name: string;
    fixtureProfile: FixtureProfile;
    location: [number, number, number];
    range: number;
    params: Record<string, unknown>;
    /** Hardware-abstract intensity trim (0–10, default 1). */
    intensityTrim?: number;
    /** Named FnCurve shaping the brightness response (default `'quadratic'`). */
    intensityFn?: string;
    target?: [number, number, number];
    rotation?: [number, number, number];
    /** Settled-dark latch for `power.sleepOnBlackout`: true once output has reached 0. */
    currentlyAsleep?: boolean;
    fixtureClass: IFixtureClass;
}

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
    if (typeof o['guid'] === 'string') {
        out.guid = o['guid'];
    }
    if (o['target'] !== undefined && isTuple3(o['target'])) {
        out.target = o['target'];
    }
    if (o['rotation'] !== undefined && isTuple3(o['rotation'])) {
        out.rotation = o['rotation'];
    }
    if (typeof o['intensityTrim'] === 'number' && Number.isFinite(o['intensityTrim']) && o['intensityTrim'] >= 0) {
        out.intensityTrim = o['intensityTrim'];
    }
    if (typeof o['intensityFn'] === 'string' && o['intensityFn'].length > 0) {
        out.intensityFn = o['intensityFn'];
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
        .filter((f): f is ConfiguredFixtureDraft => f !== null);
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
                Logger.warn(`[config] will not handle fixture class: ${f.fixtureProfile.class} ("${f.name}" in zone "${z.name}")`);
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
    private neewerBus: NeewerBus;
    private onConfigApplied: (() => void) | null = null;

    constructor(neewerBus: NeewerBus) {
        this.neewerBus = neewerBus;
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

        const fixtureEntries: Array<{ fixture: ConfiguredFixture; match: BleMatch }> = [];
        for (const zone of this.zones) {
            for (const fixture of zone.fixtures) {
                const rawAddress = fixture.params['bluetoothAddress'];
                const bluetoothAddress = typeof rawAddress === 'string' ? rawAddress : '';
                const rawId = fixture.params['bluetoothId'];
                const bluetoothId = typeof rawId === 'string' && rawId.trim().length > 0 ? rawId.trim() : undefined;

                const hasMac = normalizeBleAddress(bluetoothAddress).length === 12;
                if (bluetoothAddress.length > 0 && !hasMac) {
                    Logger.warn(
                        `[config] fixture "${fixture.name}" params.bluetoothAddress must be a BLE MAC (e.g. ca:25:a6:0d:57:3d)`,
                    );
                }
                if (!hasMac && bluetoothId === undefined) {
                    Logger.warn(
                        `[config] fixture "${fixture.name}" needs params.bluetoothId (noble id, macOS) and/or params.bluetoothAddress (MAC, Linux) — see "npm run discover". Will not be driven`,
                    );
                    continue;
                }
                // Match by exact noble id (macOS) or MAC (Linux) — set both in config; the renderer uses whichever the OS provides.
                const match: BleMatch = {
                    ...(hasMac ? { address: bluetoothAddress } : {}),
                    ...(bluetoothId !== undefined ? { id: bluetoothId } : {}),
                };
                fixtureEntries.push({ fixture, match });
            }
        }
        this.neewerBus.syncFixtures(fixtureEntries);

        if (this.onConfigApplied) {
            this.onConfigApplied();
        }
    }

    getZones(): ConfiguredZone[] {
        return this.zones;
    }
}
