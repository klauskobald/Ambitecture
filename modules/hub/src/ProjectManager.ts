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
  class: string;
  params: Record<string, unknown>;
}

interface ControllerDef {
  name: string;
  guid: string;
  intents: ControllerIntent[];
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

export interface Zone {
  name: string;
  boundingBox?: [number, number, number, number, number, number];
  fixtures: FixtureInstance[];
}

interface Project {
  name: string;
  'zone-to-renderer': Record<string, string[]>;
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
    for (const controller of this.project.controller ?? []) {
      for (const intent of controller.intents) {
        if (!intent.guid) {
          intent.guid = randomUUID();
        }
      }
    }
    this.fixtureProfiles.clear();
    this.loadReferencedFixtures();
    Logger.info(`[project] loaded "${this.project.name}" with ${this.project.zones.length} zone(s)`);
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
    const out: Record<string, unknown> = {
      name: zone.name,
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
    const zones = this.project.zones.filter(z => assignedZoneNames.has(z.name));
    const result = {
      projectName: this.project.name,
      zones: zones.map((z) => this.serializeZone(z)),
    };
    Logger.info(`[project] buildRendererConfig(${rendererGuid}): ${zones.length} zone(s), ${zones.reduce((n, z) => n + z.fixtures.length, 0)} fixture(s)`);
    return result;
  }

  buildControllerConfig(guid: string): object {
    if (!this.project) {
      throw new Error('[project] No project loaded — call useProject() first');
    }
    const controllers = this.project.controller ?? [];
    const match = controllers.find(c => c.guid === guid);
    const cached = this.intentCache.get(guid);
    const intents = cached ? [...cached.values()] : (match?.intents ?? []);
    Logger.info(`[project] buildControllerConfig(${guid}): ${this.project.zones.length} zone(s), ${intents.length} intent(s)`);
    return {
      projectName: this.project.name,
      zoneToRenderer: this.project['zone-to-renderer'] ?? {},
      zones: this.project.zones.map((z) => this.serializeZone(z)),
      intents,
    };
  }
}
