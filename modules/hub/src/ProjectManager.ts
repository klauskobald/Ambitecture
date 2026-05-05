import * as path from 'path';
import { randomUUID } from 'crypto';
import { Config } from './Config';
import { Logger } from './Logger';
import { applyDotPathPatch, cloneRecord, removeAtDotPath, setAtDotPath } from './dotPath';

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

/** Nested under intent `perform` in project YAML — forward-compatible buckets. */
export interface IntentPerformReset {
  scene?: boolean;
  [key: string]: unknown;
}

export interface IntentPerformSettings {
  reset?: IntentPerformReset;
  [key: string]: unknown;
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
  perform?: IntentPerformSettings;
}

export interface Scene {
  guid?: string;
  name: string;
  intents: SceneIntentRef[];
}

export interface SceneIntentRef {
  guid: string;
  overlay?: Record<string, unknown>;
}

export interface ActionSceneExecuteItem {
  type: 'scene';
  guid: string;
}

export interface ActionIntentExecuteItem {
  type: 'intent';
  guid: string;
  params?: Record<string, unknown>;
  patch?: Record<string, unknown>;
  remove?: string[];
  value?: Record<string, unknown>;
  scheduled?: number;
}

export interface ActionUnknownExecuteItem {
  type: string;
  guid?: string;
  [key: string]: unknown;
}

export type ActionExecuteItem =
  | ActionSceneExecuteItem
  | ActionIntentExecuteItem
  | ActionUnknownExecuteItem;

export interface ActionDefinition {
  guid?: string;
  name: string;
  execute: ActionExecuteItem[];
}

export interface InputDefinition {
  guid?: string;
  name: string;
  type: string;
  params?: Record<string, unknown>;
  action?: string;
  context?: string;
  target?: {
    type: string;
    guid: string;
  };
  display?: Record<string, unknown>;
  /** Perform pane / controller: explicit button order (lower first). */
  _sortIdx?: number;
}

interface ControllerDef {
  name: string;
  guid: string;
  intents?: { guid: string }[];
  inputs?: InputDefinition[];
  interactionPolicies?: Record<string, unknown>;
  [key: string]: unknown;  // pass-through for controller-specific config
}

/** Per-instance fields from project YAML; class-specific keys live in `params`. */
interface FixtureInstance {
  guid?: string;
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
  guid?: string;
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
  actions?: ActionDefinition[];
  activeScene?: string;
  zones: Zone[];
  controller?: ControllerDef[];
  graphEntities?: Record<string, Record<string, unknown>>;
}

export class ProjectManager {
  private projectsPath: string;
  private fixturesPath: string;
  private project: Project | null = null;
  private fixtureProfiles: Map<string, FixtureProfile> = new Map();
  private intentDefinitions: Map<string, ControllerIntent> = new Map();
  private activeSceneName: string | null = null;
  private runtimeZones: Zone[] = [];
  private _projectConfig: Config | null = null;
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** When set, `getControllerIntents` / `buildControllerConfig` use hub runtime merge (perform). */
  private effectiveIntentResolver: ((guid: string) => ControllerIntent | undefined) | undefined;

  constructor(projectsPath: string, fixturesPath: string) {
    this.projectsPath = projectsPath;
    this.fixturesPath = fixturesPath;
  }

  useProject(name: string, callback: () => void): void {
    this.reloadProject(name);
    callback();
  }

  private _rebuildIntentDefinitions(intents: ControllerIntent[]): void {
    this.intentDefinitions = new Map();
    for (const intent of intents) {
      if (!intent.guid) {
        intent.guid = randomUUID();
      }
      this.intentDefinitions.set(intent.guid, intent);
    }
  }

  private reloadProject(name: string): void {
    const filePath = this.resolvePath(this.projectsPath, `${name}.yml`);
    this._projectConfig = new Config(filePath);
    this.project = this._projectConfig.getAll() as Project;

    this._rebuildIntentDefinitions(this.project.intents ?? []);
    const createdGuids = this._ensureGraphGuids();

    // Auto-create "untitled" scene if intents exist but no scenes defined
    if ((!this.project.scenes || this.project.scenes.length === 0) && (this.project.intents ?? []).length > 0) {
      this.project.scenes = [{
        name: 'untitled',
        intents: (this.project.intents ?? []).map(i => ({ guid: i.guid! })),
      }];
      Logger.info('[project] auto-created "untitled" scene with all project intents');
    }

    const scenes = this.project.scenes ?? [];
    const storedScene = scenes.find(s => s.name === this.project!.activeScene);
    const initialScene = storedScene ?? scenes[0];
    this.activeSceneName = initialScene?.name ?? null;

    this.fixtureProfiles.clear();
    this.loadReferencedFixtures();
    this.runtimeZones = this.project.zones.map((zone) => ({
      ...zone,
      fixtures: zone.fixtures.map((fixture) => this.cloneFixtureInstance(fixture)),
    }));

    Logger.info(`[project] loaded "${this.project.name}" with ${this.project.zones.length} zone(s), ${this.intentDefinitions.size} intent(s), ${(this.project.scenes ?? []).length} scene(s)`);
    if (createdGuids) {
      this._scheduleSave();
    }
  }

  private _ensureGraphGuids(): boolean {
    if (!this.project) return false;
    let changed = false;
    const ensureGuid = (item: Record<string, unknown>, prefix: string): void => {
      if (typeof item['guid'] === 'string' && item['guid'].length > 0) return;
      item['guid'] = `${prefix}-${randomUUID()}`;
      changed = true;
    };
    for (const intent of this.project.intents ?? []) {
      ensureGuid(intent as unknown as Record<string, unknown>, 'intent');
    }
    for (const scene of this.project.scenes ?? []) {
      ensureGuid(scene as unknown as Record<string, unknown>, 'scene');
    }
    for (const action of this.project.actions ?? []) {
      ensureGuid(action as unknown as Record<string, unknown>, 'action');
    }
    for (const zone of this.project.zones) {
      ensureGuid(zone as unknown as Record<string, unknown>, 'zone');
      for (const fixture of zone.fixtures) {
        ensureGuid(fixture as unknown as Record<string, unknown>, 'fixture');
      }
    }
    for (const controller of this.project.controller ?? []) {
      ensureGuid(controller as unknown as Record<string, unknown>, 'controller');
      for (const input of controller.inputs ?? []) {
        ensureGuid(input as unknown as Record<string, unknown>, 'input');
      }
    }
    const knownTopLevel = new Set(['name', 'zone-to-renderer', 'intents', 'scenes', 'actions', 'activeScene', 'zones', 'controller']);
    for (const [key, value] of Object.entries(this.project as unknown as Record<string, unknown>)) {
      if (knownTopLevel.has(key) || !Array.isArray(value)) continue;
      const prefix = key.endsWith('s') ? key.slice(0, -1) : key;
      for (const item of value) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          ensureGuid(item as Record<string, unknown>, prefix);
        }
      }
    }
    for (const [entityType, entities] of Object.entries(this.project.graphEntities ?? {})) {
      for (const [guid, entity] of Object.entries(entities)) {
        if (entity && typeof entity === 'object' && !Array.isArray(entity)) {
          const record = entity as Record<string, unknown>;
          if (typeof record['guid'] !== 'string') {
            record['guid'] = guid;
            changed = true;
          }
          if (typeof record['entityType'] !== 'string') {
            record['entityType'] = entityType;
            changed = true;
          }
        }
      }
    }
    if (changed) {
      this._rebuildIntentDefinitions(this.project.intents ?? []);
    }
    return changed;
  }

  updateFixtures(updates: FixtureMoveUpdate[]): number {
    let changed = 0;
    for (const update of updates) {
      if (this.updateFixture(update)) {
        changed += 1;
      }
    }
    if (changed > 0) {
      this.project!.zones = this.runtimeZones.map((zone) => ({
        ...zone,
        fixtures: zone.fixtures.map((fixture) => this.cloneFixtureInstance(fixture)),
      }));
      this._scheduleSave();
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
      ...(fixture.guid !== undefined ? { guid: fixture.guid } : {}),
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

  updateIntents(_controllerGuid: string, updatedIntents: ControllerIntent[]): void {
    for (const intent of updatedIntents) {
      if (!intent.guid) continue;
      const existing = this.intentDefinitions.get(intent.guid);
      if (!existing) continue;
      this.intentDefinitions.set(intent.guid, { ...existing, ...intent });
    }
  }

  /**
   * Enables merged perform/runtime intent state for controller wire payloads (`graph:init`, `projectPatch`).
   * Pass `undefined` to clear (e.g. in tests).
   */
  configureEffectiveIntentResolver(
    resolver: ((guid: string) => ControllerIntent | undefined) | undefined,
  ): void {
    this.effectiveIntentResolver = resolver;
  }

  getControllerIntents(controllerGuid: string): ControllerIntent[] {
    const match = (this.project?.controller ?? []).find(c => c.guid === controllerGuid);
    if (!match) return [];
    return (match.intents ?? [])
      .map(ref => {
        const resolved = this.effectiveIntentResolver?.(ref.guid);
        if (resolved !== undefined) {
          return resolved;
        }
        return this.intentDefinitions.get(ref.guid);
      })
      .filter((i): i is ControllerIntent => i !== undefined);
  }

  getControllerInteractionPolicies(controllerGuid: string): Record<string, unknown> {
    const match = (this.project?.controller ?? []).find(c => c.guid === controllerGuid);
    return match?.interactionPolicies ?? {};
  }

  getControllerState(controllerGuid: string): Record<string, unknown> {
    const match = (this.project?.controller ?? []).find(c => c.guid === controllerGuid);
    if (!match) return {};
    const state: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(match)) {
      if (key === 'name' || key === 'guid' || key === 'intents' || key === 'inputs') continue;
      state[key] = value;
    }
    return state;
  }

  updateControllerState(controllerGuid: string, patch: Record<string, unknown>, remove: string[] = []): boolean {
    const match = (this.project?.controller ?? []).find(c => c.guid === controllerGuid);
    if (!match) return false;
    for (const [key, value] of Object.entries(patch)) {
      setAtDotPath(match as unknown as Record<string, unknown>, key, value);
    }
    for (const key of remove) {
      removeAtDotPath(match as unknown as Record<string, unknown>, key);
    }
    this._scheduleSave();
    return true;
  }

  private getControllerRecord(controllerGuid: string): ControllerDef | undefined {
    return (this.project?.controller ?? []).find(c => c.guid === controllerGuid);
  }

  getInputsWirePayload(controllerGuid: string): InputDefinition[] {
    return this.getControllerRecord(controllerGuid)?.inputs ?? [];
  }

  setControllerInputs(controllerGuid: string, inputs: InputDefinition[]): void {
    const match = this.getControllerRecord(controllerGuid);
    if (!match || !this.project) return;
    match.inputs = inputs;
    this.project.controller = [...(this.project.controller ?? [])];
    this._scheduleSave();
  }

  findControllerGuidForInput(inputGuid: string): string | undefined {
    for (const controller of this.project?.controller ?? []) {
      const inputs = controller.inputs ?? [];
      if (inputs.some(input => input.guid === inputGuid)) {
        return controller.guid;
      }
    }
    return undefined;
  }

  getInputByGuid(inputGuid: string): InputDefinition | undefined {
    for (const controller of this.project?.controller ?? []) {
      const found = (controller.inputs ?? []).find(input => input.guid === inputGuid);
      if (found) return found;
    }
    return undefined;
  }

  getAllIntentDefinitions(): ControllerIntent[] {
    return [...this.intentDefinitions.values()];
  }

  getGraphEntities(): Record<string, Record<string, Record<string, unknown>>> {
    const entities: Record<string, Record<string, Record<string, unknown>>> = {};
    const add = (entityType: string, guid: unknown, value: Record<string, unknown>): void => {
      if (typeof guid !== 'string' || guid.length === 0) return;
      if (!entities[entityType]) entities[entityType] = {};
      entities[entityType]![guid] = value;
    };
    for (const intent of this.intentDefinitions.values()) {
      add('intent', intent.guid, { ...intent });
    }
    for (const scene of this.project?.scenes ?? []) {
      add('scene', scene.guid, { ...scene });
    }
    for (const action of this.project?.actions ?? []) {
      add('action', action.guid, { ...action });
    }
    for (const controller of this.project?.controller ?? []) {
      add('controller', controller.guid, { ...controller });
      for (const input of controller.inputs ?? []) {
        add('input', input.guid, { ...input });
      }
    }
    for (const zone of this.runtimeZones) {
      add('zone', zone.guid, this.serializeZone(zone));
      for (const fixture of zone.fixtures) {
        add('fixture', fixture.guid, {
          ...this.serializeFixtureInstance(fixture),
          zoneGuid: zone.guid,
          zoneName: zone.name,
        });
      }
    }
    const knownTopLevel = new Set(['name', 'zone-to-renderer', 'intents', 'scenes', 'actions', 'activeScene', 'zones', 'controller']);
    for (const [key, value] of Object.entries(this.project as unknown as Record<string, unknown>)) {
      if (knownTopLevel.has(key) || !Array.isArray(value)) continue;
      const entityType = key.endsWith('s') ? key.slice(0, -1) : key;
      for (const item of value) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const record = item as Record<string, unknown>;
          add(entityType, record['guid'], { ...record });
        }
      }
    }
    for (const [entityType, entityMap] of Object.entries(this.project?.graphEntities ?? {})) {
      for (const [guid, entity] of Object.entries(entityMap)) {
        if (entity && typeof entity === 'object' && !Array.isArray(entity)) {
          add(entityType, guid, { ...(entity as Record<string, unknown>) });
        }
      }
    }
    return entities;
  }

  upsertOpaqueGraphEntity(entityType: string, guid: string, value: Record<string, unknown>): void {
    if (!this.project) return;
    const collection = this.getOpaqueTopLevelCollection(entityType);
    const next = { ...value, guid, entityType };
    if (collection) {
      const index = collection.findIndex(item => item && typeof item === 'object' && !Array.isArray(item) && item['guid'] === guid);
      if (index >= 0) {
        collection[index] = next;
      } else {
        collection.push(next);
      }
    } else {
      this.project.graphEntities ??= {};
      this.project.graphEntities[entityType] ??= {};
      this.project.graphEntities[entityType][guid] = next;
    }
    this._scheduleSave();
  }

  removeOpaqueGraphEntity(entityType: string, guid: string): void {
    if (!this.project) return;
    const collection = this.getOpaqueTopLevelCollection(entityType);
    if (collection) {
      const index = collection.findIndex(item => item && typeof item === 'object' && !Array.isArray(item) && item['guid'] === guid);
      if (index >= 0) {
        collection.splice(index, 1);
        this._scheduleSave();
      }
      return;
    }
    if (this.project.graphEntities?.[entityType]?.[guid]) {
      delete this.project.graphEntities[entityType][guid];
      this._scheduleSave();
    }
  }

  private getOpaqueTopLevelCollection(entityType: string): Record<string, unknown>[] | null {
    if (!this.project) return null;
    const projectRecord = this.project as unknown as Record<string, unknown>;
    const candidates = [`${entityType}s`, `${entityType}es`];
    for (const key of candidates) {
      const value = projectRecord[key];
      if (Array.isArray(value)) {
        return value as Record<string, unknown>[];
      }
    }
    return null;
  }

  setProjectData(key: string, data: unknown): void {
    if (!this.project) return;
    const segments = key.split('.');
    setAtDotPath(this.project as unknown as Record<string, unknown>, key, data);
    if (segments[0] === 'intents') {
      this._rebuildIntentDefinitions(this.project.intents ?? []);
    }
    Logger.info(`[project] set key "${key}" in memory`);
    this._scheduleSave();
  }

  private _scheduleSave(): void {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      if (!this._projectConfig || !this.project) return;
      try {
        this._projectConfig.save(this.project);
        Logger.info('[project] saved to disk');
      } catch (err) {
        Logger.error('[project] save failed:', err);
      }
    }, 2000);
  }

  /**
   * @param persistDurable When false, updates live hub scene only (no `project.activeScene` write,
   * no disk save). Use for perform / action scene switches; use true for edit-pane commits.
   */
  setActiveScene(sceneName: string, persistDurable = true): ControllerIntent[] {
    const scenes = this.project?.scenes ?? [];
    const scene = scenes.find(s => s.name === sceneName);
    if (!scene) {
      Logger.warn(`[project] Scene "${sceneName}" not found`);
      return [];
    }
    this.activeSceneName = sceneName;
    if (this.project && persistDurable) {
      this.project.activeScene = sceneName;
      this._scheduleSave();
    }
    const intents = this.getActiveSceneIntents();
    Logger.info(
      `[project] Activated scene "${sceneName}" with ${intents.length} intent(s)${persistDurable ? '' : ' (runtime only, not persisted)'}`,
    );
    return intents;
  }

  getAllIntentDefinitionGuids(): string[] {
    return [...this.intentDefinitions.keys()];
  }

  getIntentDefinition(guid: string): ControllerIntent | undefined {
    return this.intentDefinitions.get(guid);
  }

  getActiveSceneName(): string | null {
    return this.activeSceneName;
  }

  getActiveSceneIntents(): ControllerIntent[] {
    if (!this.activeSceneName || !this.project?.scenes) return [];
    const scene = this.project.scenes.find(s => s.name === this.activeSceneName);
    if (!scene) return [];
    return scene.intents
      .map(ref => this.getEffectiveSceneIntent(ref))
      .filter((i): i is ControllerIntent => i !== undefined);
  }

  /** Intent GUIDs referenced by scene `sceneName` (refs only; does not require scene to be active). */
  getSceneIntentGuidsByName(sceneName: string): string[] {
    const scene = this.project?.scenes?.find(s => s.name === sceneName);
    if (!scene?.intents) return [];
    return scene.intents
      .map(ref => ref.guid)
      .filter((g): g is string => typeof g === 'string' && g.length > 0);
  }

  /**
   * Definition + scene ref overlay merged for named scene (does not depend on {@link activeSceneName}).
   * Used before scene activation — e.g. `perform.reset.scene` for selective merge-cache eviction.
   */
  getSceneMergedIntent(sceneName: string, guid: string): ControllerIntent | undefined {
    const scene = this.project?.scenes?.find(s => s.name === sceneName);
    if (!scene) return undefined;
    const ref = scene.intents.find(item => item.guid === guid);
    if (!ref) return undefined;
    return this.getEffectiveSceneIntent(ref);
  }

  getActiveSceneIntent(guid: string): ControllerIntent | undefined {
    if (!this.activeSceneName || !this.project?.scenes) return this.intentDefinitions.get(guid);
    const scene = this.project.scenes.find(s => s.name === this.activeSceneName);
    const ref = scene?.intents.find(item => item.guid === guid);
    if (!ref) return undefined;
    return this.getEffectiveSceneIntent(ref);
  }

  private getEffectiveSceneIntent(ref: SceneIntentRef): ControllerIntent | undefined {
    const intent = this.intentDefinitions.get(ref.guid);
    if (!intent) return undefined;
    const base = cloneRecord(intent as unknown as Record<string, unknown>);
    const overlay = ref.overlay && typeof ref.overlay === 'object' && !Array.isArray(ref.overlay)
      ? ref.overlay
      : {};
    return applyDotPathPatch(base, overlay) as unknown as ControllerIntent;
  }

  isIntentInActiveScene(guid: string): boolean {
    if (!this.activeSceneName || !this.project?.scenes) return true;
    const scene = this.project.scenes.find(s => s.name === this.activeSceneName);
    if (!scene) return false;
    return scene.intents.some(ref => ref.guid === guid);
  }

  getSceneNames(): string[] {
    return (this.project?.scenes ?? []).map(s => s.name);
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
      ...(fi.guid !== undefined ? { guid: fi.guid } : {}),
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

  /** Serialized runtime zones for incremental controller sync (same shape as full config). */
  getSerializedRuntimeZones(): unknown[] {
    return this.runtimeZones.map((z) => this.serializeZone(z));
  }

  getZoneToRendererPayload(): Record<string, string[]> {
    return this.project?.['zone-to-renderer'] ?? {};
  }

  getControllersWirePayload(): ControllerDef[] {
    return this.project?.controller ?? [];
  }

  getScenesWirePayload(): Scene[] {
    return this.project?.scenes ?? [];
  }

  getActionsWirePayload(): ActionDefinition[] {
    return this.project?.actions ?? [];
  }

  getSceneByGuid(guid: string): Scene | undefined {
    return (this.project?.scenes ?? []).find(scene => scene.guid === guid);
  }

  getActionByGuid(guid: string): ActionDefinition | undefined {
    return (this.project?.actions ?? []).find(action => action.guid === guid);
  }

  getWireProjectName(): string {
    return this.project?.name ?? '';
  }

  private serializeZone(zone: Zone): Record<string, unknown> {
    const zoneExtend = typeof zone.extend === 'number' && Number.isFinite(zone.extend)
      ? zone.extend
      : 1;
    const out: Record<string, unknown> = {
      ...(zone.guid !== undefined ? { guid: zone.guid } : {}),
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

    const intents = this.getControllerIntents(guid);

    // Pass through all controller-specific keys (interactionPolicies, etc.)
    const passThrough: Record<string, unknown> = {};
    if (match) {
      for (const key of Object.keys(match)) {
        if (key !== 'name' && key !== 'guid' && key !== 'intents' && key !== 'inputs') {
          passThrough[key] = match[key];
        }
      }
    }

    const scenes = this.project.scenes ?? [];
    const actions = this.project.actions ?? [];
    const inputs = match?.inputs ?? [];
    Logger.info(`[project] buildControllerConfig(${guid}): ${this.runtimeZones.length} zone(s), ${intents.length} intent(s), ${scenes.length} scene(s)`);
    return {
      projectName: this.project.name,
      zoneToRenderer: this.project['zone-to-renderer'] ?? {},
      zones: this.runtimeZones.map((z) => this.serializeZone(z)),
      intents,
      scenes,
      actions,
      inputs,
      activeSceneName: this.activeSceneName,
      ...passThrough,
    };
  }
}
