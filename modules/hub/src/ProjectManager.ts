import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Config } from './Config';
import { Logger } from './Logger';

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

export interface ControllerIntent {
  guid?: string;
  name?: string;
  scheduled?: number;
  position?: [number, number, number];
  radius?: number;
  radiusFunction?: string;
  layer?: number;
  class: string;
  params: Record<string, unknown>;
}

export interface Scene {
  name: string;
  intents: { guid: string }[];
}

interface ControllerDef {
  name: string;
  guid: string;
  intents: { guid: string }[];
  [key: string]: unknown;  // pass-through for controller-specific config
}

/** Per-instance fields from project YAML; class-specific keys live in `params`. */
interface FixtureInstance {
  name: string;
  fixture: string;
  location: [number, number, number];
  target?: [number, number, number];
  rotation?: [number, number, number];
  range: number;
  params?: Record<string, unknown>;
}

export interface FixtureMoveUpdate {
  zoneName: string;
  fixtureName: string;
  position: [number, number, number];
}

export interface Zone {
  name: string;
  boundingBox?: [number, number, number, number, number, number];
  extend?: number;
  fixtures: FixtureInstance[];
}

interface Project {
  name: string;
  'zone-to-renderer': Record<string, string[]>;
  intents?: ControllerIntent[];
  scenes?: Scene[];
  zones: Zone[];
  controller?: ControllerDef[];
}

export class ProjectManager {
  private projectsPath: string;
  private fixturesPath: string;
  private project: Project | null = null;
  private fixtureProfiles: Map<string, FixtureProfile> = new Map();
  private watchers: fs.FSWatcher[] = [];
  private intentCache: Map<string, Map<string, ControllerIntent>> = new Map();
  private intentDefinitions: Map<string, ControllerIntent> = new Map();
  private activeSceneName: string | null = null;
  private activeSceneIntents: ControllerIntent[] = [];
  private runtimeZones: Zone[] = [];
  private overrides: Map<string, unknown> = new Map();

  constructor(projectsPath: string, fixturesPath: string) {
    this.projectsPath = projectsPath;
    this.fixturesPath = fixturesPath;
  }

  useProject(name: string, callback: () => void): void {
    this.reloadProject(name);
    callback();
    this.watchAll(name, callback);
  }

  private reloadProject(name: string): void {
    const filePath = this.resolvePath(this.projectsPath, `${name}.yml`);
    this.project = new Config(filePath).getAll() as Project;
    this.intentCache.clear();

    this.intentDefinitions = new Map();
    for (const intent of this.project.intents ?? []) {
      if (!intent.guid) {
        intent.guid = randomUUID();
      }
      this.intentDefinitions.set(intent.guid, intent);
    }

    // Auto-create "untitled" scene if intents exist but no scenes defined
    if ((!this.project.scenes || this.project.scenes.length === 0) && (this.project.intents ?? []).length > 0) {
      this.project.scenes = [{
        name: 'untitled',
        intents: (this.project.intents ?? []).map(i => ({ guid: i.guid! })),
      }];
      Logger.info('[project] auto-created "untitled" scene with all project intents');
    }

    this.activeSceneName = null;
    this.activeSceneIntents = [];
    this.overrides.clear();

    this.fixtureProfiles.clear();
    this.loadReferencedFixtures();
    this.runtimeZones = this.project.zones.map((zone) => ({
      ...zone,
      fixtures: zone.fixtures.map((fixture) => this.cloneFixtureInstance(fixture)),
    }));
    Logger.info(`[project] loaded "${this.project.name}" with ${this.project.zones.length} zone(s), ${this.intentDefinitions.size} intent(s), ${(this.project.scenes ?? []).length} scene(s)`);
  }

  updateFixtures(updates: FixtureMoveUpdate[]): number {
    let changed = 0;
    for (const update of updates) {
      if (this.updateFixture(update)) {
        changed += 1;
      }
    }
    return changed;
  }

  private updateFixture(update: FixtureMoveUpdate): boolean {
    const sourceZone = this.runtimeZones.find((zone) => zone.name === update.zoneName);
    const fallbackZone = this.runtimeZones.find((zone) =>
      zone.fixtures.some((fixture) => fixture.name === update.fixtureName)
    );
    const fixtureZone = sourceZone ?? fallbackZone;
    if (!fixtureZone || !fixtureZone.boundingBox) {
      return false;
    }
    const fixtureIndex = fixtureZone.fixtures.findIndex((fixture) => fixture.name === update.fixtureName);
    if (fixtureIndex < 0) {
      return false;
    }
    const destinationZone = this.runtimeZones.find((zone) =>
      zone.boundingBox !== undefined && this.isWithinBoundingBox(update.position, zone.boundingBox)
    );
    if (!destinationZone || !destinationZone.boundingBox) {
      return false;
    }
    const fixture = fixtureZone.fixtures[fixtureIndex];
    if (!fixture) {
      return false;
    }
    const localPosition: [number, number, number] = [
      update.position[0] - destinationZone.boundingBox[0],
      update.position[1] - destinationZone.boundingBox[1],
      update.position[2] - destinationZone.boundingBox[2],
    ];
    if (fixtureZone.name === destinationZone.name) {
      fixtureZone.fixtures[fixtureIndex] = { ...fixture, location: localPosition };
      return true;
    }
    fixtureZone.fixtures.splice(fixtureIndex, 1);
    destinationZone.fixtures.push({ ...fixture, location: localPosition });
    return true;
  }

  private cloneFixtureInstance(fixture: FixtureInstance): FixtureInstance {
    const cloned: FixtureInstance = {
      name: fixture.name,
      fixture: fixture.fixture,
      location: [...fixture.location] as [number, number, number],
      range: fixture.range,
      ...(fixture.target !== undefined ? { target: [...fixture.target] as [number, number, number] } : {}),
      ...(fixture.rotation !== undefined ? { rotation: [...fixture.rotation] as [number, number, number] } : {}),
      ...(fixture.params !== undefined ? { params: { ...fixture.params } } : {}),
    };
    return cloned;
  }

  private isWithinBoundingBox(
    position: [number, number, number],
    bbox: [number, number, number, number, number, number]
  ): boolean {
    return position[0] >= bbox[0] && position[0] <= bbox[3]
      && position[1] >= bbox[1] && position[1] <= bbox[4]
      && position[2] >= bbox[2] && position[2] <= bbox[5];
  }

  updateIntents(controllerGuid: string, updatedIntents: ControllerIntent[]): void {
    const withGuids = updatedIntents.filter(i => i.guid);
    if (withGuids.length === 0) return;
    const cache = this.intentCache.get(controllerGuid) ?? new Map<string, ControllerIntent>();
    for (const intent of withGuids) {
      cache.set(intent.guid!, intent);
    }
    this.intentCache.set(controllerGuid, cache);
  }

  getControllerIntents(controllerGuid: string): ControllerIntent[] {
    const match = (this.project?.controller ?? []).find(c => c.guid === controllerGuid);
    const baseIntents = match
      ? match.intents
          .map(ref => this.intentDefinitions.get(ref.guid))
          .filter((i): i is ControllerIntent => i !== undefined)
      : [];
    const merged = new Map<string, ControllerIntent>(baseIntents.map(i => [i.guid!, i]));
    const cached = this.intentCache.get(controllerGuid);
    if (cached) {
      for (const [guid, intent] of cached) merged.set(guid, intent);
    }
    return [...merged.values()];
  }

  setOverride(key: string, data: unknown): void {
    this.overrides.set(key, data);
    Logger.info(`[project] override set for key "${key}"`);
  }

  private applyOverrides(base: Record<string, unknown>): Record<string, unknown> {
    let result = base;
    const keys = [...this.overrides.keys()].sort();
    for (const key of keys) {
      const value = this.overrides.get(key);
      result = this._setAtPath(result, key.split('.'), value) as Record<string, unknown>;
    }
    return result;
  }

  private _setAtPath(current: unknown, segments: string[], value: unknown): unknown {
    if (segments.length === 0) return value;
    const first = segments[0]!;
    const rest = segments.slice(1);

    if (Array.isArray(current)) {
      const idx = parseInt(first, 10);
      if (isNaN(idx) || idx < 0) return current;
      const clone = [...current];
      clone[idx] = this._setAtPath(clone[idx], rest, value);
      return clone;
    }

    if (current !== null && typeof current === 'object') {
      const obj = current as Record<string, unknown>;
      return { ...obj, [first]: this._setAtPath(obj[first], rest, value) };
    }

    return { [first]: this._setAtPath(undefined, rest, value) };
  }

  setActiveScene(sceneName: string): ControllerIntent[] {
    const scenes = this.project?.scenes ?? [];
    const scene = scenes.find(s => s.name === sceneName);
    if (!scene) {
      Logger.warn(`[project] Scene "${sceneName}" not found`);
      return [];
    }
    this.activeSceneName = sceneName;
    this.activeSceneIntents = scene.intents
      .map(ref => this.intentDefinitions.get(ref.guid))
      .filter((i): i is ControllerIntent => i !== undefined);
    Logger.info(`[project] Activated scene "${sceneName}" with ${this.activeSceneIntents.length} intent(s)`);
    return this.activeSceneIntents;
  }

  getActiveSceneName(): string | null {
    return this.activeSceneName;
  }

  getActiveSceneIntents(): ControllerIntent[] {
    return this.activeSceneIntents;
  }

  getSceneNames(): string[] {
    return (this.project?.scenes ?? []).map(s => s.name);
  }

  private watchAll(name: string, callback: () => void): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];

    const onChange = (trigger: string) => {
      Logger.info(`[project] change detected in "${trigger}", reloading...`);
      this.reloadProject(name);
      this.watchAll(name, callback);
      callback();
    };

    const projectFile = this.resolvePath(this.projectsPath, `${name}.yml`);
    this.watchers.push(fs.watch(projectFile, (eventType) => {
      if (eventType === 'change' || eventType === 'rename') {
        onChange(`${name}.yml`);
      }
    }));

    const fixtureNames = new Set<string>();
    for (const zone of this.project!.zones) {
      for (const fi of zone.fixtures) {
        fixtureNames.add(fi.fixture);
      }
    }
    Logger.info(`[project] watching ${fixtureNames.size} fixture file(s): ${[...fixtureNames].join(', ')}`);
    for (const fixtureName of fixtureNames) {
      const fixtureFile = this.resolvePath(this.fixturesPath, `${fixtureName}.yml`);
      this.watchers.push(fs.watch(fixtureFile, (eventType) => {
        if (eventType === 'change' || eventType === 'rename') {
          onChange(`${fixtureName}.yml`);
        }
      }));
    }
  }

  private resolvePath(base: string, file: string): string {
    const resolvedBase = path.isAbsolute(base)
      ? base
      : path.resolve(process.cwd(), base);
    return path.join(resolvedBase, file);
  }

  private loadReferencedFixtures(): void {
    const fixtureNames = new Set<string>();
    for (const zone of this.project!.zones) {
      for (const fi of zone.fixtures) {
        fixtureNames.add(fi.fixture);
      }
    }
    Logger.info(`[project] loading ${fixtureNames.size} unique fixture profile(s) for ${this.project!.zones.reduce((n, z) => n + z.fixtures.length, 0)} fixture instance(s)`);
    for (const name of fixtureNames) {
      const filePath = this.resolvePath(this.fixturesPath, `${name}.yml`);
      const profile = new Config(filePath).getAll() as FixtureProfile;
      this.fixtureProfiles.set(name, profile);
      Logger.info(`[project] loaded fixture profile "${name}" (class: ${profile.class})`);
    }
  }

  private serializeFixtureInstance(fi: FixtureInstance): Record<string, unknown> {
    const profile = this.fixtureProfiles.get(fi.fixture);
    if (!profile) {
      Logger.warn(`[project] fixture instance "${fi.name}" references unknown profile "${fi.fixture}"`);
    }
    const entry: Record<string, unknown> = {
      name: fi.name,
      fixtureProfile: profile,
      location: fi.location,
      range: fi.range,
    };
    if (fi.params !== undefined && Object.keys(fi.params).length > 0) {
      entry['params'] = fi.params;
    }
    if (fi.target !== undefined) entry['target'] = fi.target;
    if (fi.rotation !== undefined) entry['rotation'] = fi.rotation;
    return entry;
  }

  private serializeZone(zone: Zone): Record<string, unknown> {
    const zoneExtend = typeof zone.extend === 'number' && Number.isFinite(zone.extend)
      ? zone.extend
      : 1;
    const out: Record<string, unknown> = {
      name: zone.name,
      extend: zoneExtend,
      fixtures: zone.fixtures.map((fi) => this.serializeFixtureInstance(fi)),
    };
    if (zone.boundingBox !== undefined) {
      out['boundingBox'] = zone.boundingBox;
    }
    return out;
  }

  buildRendererConfig(rendererGuid: string): object {
    if (!this.project) {
      throw new Error('[project] No project loaded — call useProject() first');
    }
    const zoneToRenderer = this.project['zone-to-renderer'] ?? {};
    const assignedZoneNames = new Set(
      Object.entries(zoneToRenderer)
        .filter(([, renderers]) => renderers.includes(rendererGuid))
        .map(([zoneName]) => zoneName)
    );
    const zones = this.runtimeZones.filter(z => assignedZoneNames.has(z.name));
    const result = {
      projectName: this.project.name,
      zones: zones.map((z) => this.serializeZone(z)),
    };
    Logger.info(`[project] buildRendererConfig(${rendererGuid}): ${zones.length} zone(s), ${zones.reduce((n, z) => n + z.fixtures.length, 0)} fixture(s)`);
    return result;
  }

  buildControllerConfig(guid: string): Record<string, unknown> {
    if (!this.project) {
      throw new Error('[project] No project loaded — call useProject() first');
    }
    const controllers = this.project.controller ?? [];
    const match = controllers.find(c => c.guid === guid);
    const cached = this.intentCache.get(guid);

    const intentGuids = match?.intents?.map(i => i.guid) ?? [];
    const baseIntents = intentGuids
      .map(g => this.intentDefinitions.get(g))
      .filter((i): i is ControllerIntent => i !== undefined);

    const mergedIntents = new Map<string, ControllerIntent>(baseIntents.map(i => [i.guid!, i]));
    if (cached) {
      for (const [guid, intent] of cached) mergedIntents.set(guid, intent);
    }
    const intents = [...mergedIntents.values()];

    // Pass through all controller-specific keys (interactionPolicies, etc.)
    const passThrough: Record<string, unknown> = {};
    if (match) {
      for (const key of Object.keys(match)) {
        if (key !== 'name' && key !== 'guid' && key !== 'intents') {
          passThrough[key] = match[key];
        }
      }
    }

    const scenes = this.project.scenes ?? [];
    Logger.info(`[project] buildControllerConfig(${guid}): ${this.runtimeZones.length} zone(s), ${intents.length} intent(s), ${scenes.length} scene(s)`);
    const base = {
      projectName: this.project.name,
      zoneToRenderer: this.project['zone-to-renderer'] ?? {},
      zones: this.runtimeZones.map((z) => this.serializeZone(z)),
      intents,
      scenes,
      ...passThrough,
    };
    return this.applyOverrides(base);
  }
}
