import * as fs from 'fs';
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
  icon?: string;
  params: Record<string, unknown>;
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
  /** Optional; merged with trigger `args`. Use `animationGuid` + trigger `value` for start/stop side effects on that animation after scene activation. */
  params?: Record<string, unknown>;
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

export interface ActionAnimationExecuteItem {
  type: 'animation';
  /** Animation definition guid (`animations[].guid`). */
  guid: string;
}

export interface ActionSnapshotExecuteItem {
  type: 'snapshot';
  guid: string;
}

export type ActionExecuteItem =
  | ActionSceneExecuteItem
  | ActionIntentExecuteItem
  | ActionAnimationExecuteItem
  | ActionSnapshotExecuteItem
  | ActionUnknownExecuteItem;

export interface ActionDefinition {
  guid?: string;
  name: string;
  /** Single target per action (`scene` | `intent` | `animation` | `snapshot`). */
  execute: ActionExecuteItem;
}

export interface AnimationStep {
  time: number;
  args?: Record<string, unknown>;
}

/** Stored under `animations` in project YAML; paired with an auto-managed runner `action`. */
export interface AnimationDefinition {
  guid?: string;
  name?: string;
  class: string;
  /** Common to all animator classes: `auto` (default) plays on trigger; `manual` pauses at first step. */
  runmode?: 'auto' | 'manual';
  /** Intent GUIDs to drive (canonical). Runtime patches fan out to each. */
  targetIntents?: string[];
  /** @deprecated Prefer `targetIntents`. Single intent; read compatibility only when array absent. */
  targetIntent?: string;
  /** Legacy / alias for `targetIntent` (hub accepts either). */
  intent?: string;
  /**
   * Class-specific payload. For `keyframeAnimator`: `repeat`, `length`, `steps` (≥ 2; first/last times pinned to `0` and `length`), optional `lerp` — all required on the runner side under `content`.
   * Optional `lerp`: `{ quantization, time, curve, minMs? }` enables quantized eased ramps between anchors (`time <= 0` disables). `minMs` (nominal) lowers substep count so consecutive lerp `scheduled` gaps are at least `minMs × playback timescale` on the hub wall clock.
   * `ProjectGraphStore` may fold historical root-level `repeat` / `length` / `steps` into `content` on upsert; {@link KeyframeAnimator} reads **only** `definition.content` at runtime.
   */
  content?: Record<string, unknown>;
  /**
   * @deprecated For `keyframeAnimator`, use `content.repeat`. Folded into `content` on graph upsert when present at root.
   */
  repeat?: number;
  /**
   * @deprecated For `keyframeAnimator`, use `content.length`. Folded into `content` on graph upsert when present at root.
   */
  length?: number;
  /**
   * @deprecated For `keyframeAnimator`, use `content.steps`. Folded into `content` on graph upsert when present at root.
   */
  steps?: AnimationStep[];
}

export interface InputDefinition {
  guid?: string;
  name: string;
  type: string;
  display?: Record<string, unknown>;
  /** Action GUIDs this perform input fires (order preserved). */
  actions: string[];
  keyChar?: string;
  /** Perform pane / controller: explicit button order (lower first). */
  _sortIdx?: number;
}

/** Action GUIDs referenced by a controller input (empty when unassigned). */
export function inputActionGuids(input: InputDefinition): string[] {
  if (!Array.isArray(input.actions)) return [];
  return input.actions.filter((g): g is string => typeof g === 'string' && g.length > 0);
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

/**
 * Runner `action` row shares the animation guid; single execute item runs that animation.
 * Matches controller `companionAnimationRunnerAction` / hub `ProjectGraphStore.applyAnimationCommand`.
 */
export function isCompanionAnimationRunnerAction(
  action: ActionDefinition,
  animationGuid: string,
): boolean {
  const actionGuid = typeof action.guid === 'string' ? action.guid : '';
  if (actionGuid !== animationGuid) return false;
  const ex = action.execute;
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return false;
  const record = ex as Record<string, unknown>;
  return record['type'] === 'animation' && record['guid'] === animationGuid;
}

export function isCompanionSnapshotRunnerAction(
  action: ActionDefinition,
  snapshotGuid: string,
): boolean {
  const actionGuid = typeof action.guid === 'string' ? action.guid : '';
  if (actionGuid !== snapshotGuid) return false;
  const ex = action.execute;
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return false;
  const record = ex as Record<string, unknown>;
  return record['type'] === 'snapshot' && record['guid'] === snapshotGuid;
}

export interface SnapshotPulseState {
  guid: string;
  speed: number;
}

export interface SnapshotAnimationState {
  guid: string;
  timescale: number;
}

export interface SnapshotRecallFlags {
  scene: boolean;
  pulse: boolean;
  animations: boolean;
}

export interface SnapshotDefinition {
  guid?: string;
  name: string;
  recall: SnapshotRecallFlags;
  activeSceneGuid: string;
  pulses: SnapshotPulseState[];
  animations: SnapshotAnimationState[];
}

/** Drop invalid snapshot runner rows, strip non-canonical fields, and remove legacy `isRunning` rows. */
function sanitizeSnapshotStoredRow(snap: SnapshotDefinition): void {
  snap.pulses = (snap.pulses ?? []).flatMap(row => {
    const raw = row as unknown as Record<string, unknown>;
    if ('isRunning' in raw) return [];
    const guid = typeof raw['guid'] === 'string' ? raw['guid'] : '';
    const speed = raw['speed'];
    if (!guid || typeof speed !== 'number' || !Number.isFinite(speed)) return [];
    return [{ guid, speed }];
  });
  snap.animations = (snap.animations ?? []).flatMap(row => {
    const raw = row as unknown as Record<string, unknown>;
    if ('isRunning' in raw) return [];
    const guid = typeof raw['guid'] === 'string' ? raw['guid'] : '';
    const timescale = raw['timescale'];
    if (!guid || typeof timescale !== 'number' || !Number.isFinite(timescale)) return [];
    return [{ guid, timescale }];
  });
}

export interface PulseBucket {
  guid?: string;
  name?: string;
  actions: string[];
}

export interface PulseSlot {
  /** GUID of a row in `pulses.buckets`. */
  bucket?: string;
  /** When true, this slot's bucket actions fire on pulse tick. */
  active?: boolean;
}

export type PulseSlotMode = 'forward' | 'backward' | 'random';

export interface PulseSetup {
  guid?: string;
  name: string;
  bpm: number;
  meter: number;
  /**
   * Multiplier on incoming tempo for tick interval (1 = default, 2 = twice as fast).
   * Effective tick period uses `bpm * speed` in the denominator.
   */
  speed?: number;
  /** Slot order after each tick; `random` applies when {@link meter} > 2. */
  mode?: PulseSlotMode;
  slots: PulseSlot[];
}

export type PulseSyncRestartMode = 'never' | 'bar' | 'onset';

export interface PulseSyncYamlConfig {
  /** When false, hub ignores `pulse:sync` from external controllers. */
  enabled?: boolean;
  /** Which sync kinds reset pulse to slot 0 before the next aligned tick. */
  restart?: PulseSyncRestartMode;
  /** BPM blend toward analyser tempo per sync (0–1). */
  lerp?: number;
}

export interface PulsesConfig {
  setups: PulseSetup[];
  buckets: PulseBucket[];
  sync?: PulseSyncYamlConfig;
}

interface Project {
  name: string;
  'zone-to-renderer': Record<string, string[]>;
  intents?: ControllerIntent[];
  scenes?: Scene[];
  actions?: ActionDefinition[];
  animations?: AnimationDefinition[];
  pulses?: PulsesConfig;
  activeSceneGuid?: string;
  activePulseGuid?: string;
  snapshots?: SnapshotDefinition[];
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

  useProject(spec: string, callback: () => void): void {
    this.reloadProject(spec);
    callback();
  }

  private _rebuildIntentDefinitions(intents: ControllerIntent[]): void {
    this.intentDefinitions = new Map();
    for (const intent of intents) {
      if (!intent.guid) {
        intent.guid = randomUUID();
      }
      // Validate and fix position if invalid
      const validatedIntent = this._validateIntentPosition(intent);
      this.intentDefinitions.set(validatedIntent.guid!, validatedIntent);
    }
  }

  private _validateIntentPosition(intent: ControllerIntent): ControllerIntent {
    if (!intent.position || !Array.isArray(intent.position) || intent.position.length !== 3) {
      return { ...intent, position: [0, 0, 0] };
    }
    const numericPosition = [
      Number(intent.position[0]),
      Number(intent.position[1]),
      Number(intent.position[2]),
    ];
    if (numericPosition.some(n => isNaN(n))) {
      return { ...intent, position: [0, 0, 0] };
    }
    if (numericPosition[0] !== intent.position[0] || numericPosition[1] !== intent.position[1] || numericPosition[2] !== intent.position[2]) {
      return { ...intent, position: numericPosition as [number, number, number] };
    }
    return intent;
  }

  private resolveProjectYamlPath(spec: string): string {
    const trimmed = spec.trim();
    if (trimmed.length === 0) {
      throw new Error('[project] project specifier is empty');
    }
    const hasYamlSuffix = trimmed.endsWith('.yml') || trimmed.endsWith('.yaml');
    const hasSep = trimmed.includes('/') || trimmed.includes('\\');
    if (hasYamlSuffix || hasSep || path.isAbsolute(trimmed)) {
      const resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
      if (!fs.existsSync(resolved)) {
        throw new Error(`[project] file not found: ${resolved}`);
      }
      return resolved;
    }
    const underProjects = this.resolvePath(this.projectsPath, `${trimmed}.yml`);
    if (!fs.existsSync(underProjects)) {
      throw new Error(`[project] file not found: ${underProjects}`);
    }
    return underProjects;
  }

  private reloadProject(spec: string): void {
    const filePath = this.resolveProjectYamlPath(spec);
    this._projectConfig = new Config(filePath);
    this.project = this._projectConfig.getAll() as Project;

    const normalizedGraph = this._normalizeActionsAndInputsAfterLoad();
    const normalizedPulses = this._normalizePulsesAfterLoad();
    this._rebuildIntentDefinitions(this.project.intents ?? []);
    const createdGuids = this._ensureGraphGuids();
    const ensuredCompanions = this._ensureAnimationCompanionActions();

    // Auto-create "untitled" scene if no scenes defined
    let createdEmptyScene = false;
    if (!this.project.scenes || this.project.scenes.length === 0) {
      this.project.scenes = [{
        guid: `scene-${randomUUID()}`,
        name: 'untitled',
        intents: (this.project.intents ?? []).map(i => ({ guid: i.guid! })),
      }];
      Logger.info('[project] auto-created empty "untitled" scene');
      createdEmptyScene = true;
    }

    const scenes = this.project.scenes ?? [];
    const storedScene = scenes.find(s => s.guid === this.project!.activeSceneGuid);
    const initialScene = storedScene ?? scenes[0];
    this.activeSceneName = initialScene?.name ?? null;

    this.fixtureProfiles.clear();
    this.loadReferencedFixtures();
    this.runtimeZones = this.project.zones.map((zone) => ({
      ...zone,
      fixtures: zone.fixtures.map((fixture) => this.cloneFixtureInstance(fixture)),
    }));

    Logger.info(`[project] loaded "${this.project.name}" with ${this.project.zones.length} zone(s), ${this.intentDefinitions.size} intent(s), ${(this.project.scenes ?? []).length} scene(s)`);
    if (createdGuids || ensuredCompanions || normalizedGraph || normalizedPulses || createdEmptyScene) {
      this._scheduleSave();
    }
  }

  /**
   * One-time in-memory migration: `action.execute[]` → single `execute`;
   * `input.action` / `target` / `context` → `input.actions[]`; move `input.params` onto first linked intent action.
   */
  private _normalizeActionsAndInputsAfterLoad(): boolean {
    if (!this.project) return false;
    let changed = false;
    const rawActions = [...(this.project.actions ?? [])];
    const nextActions: ActionDefinition[] = [];
    const droppedActionGuids = new Set<string>();

    for (const raw of rawActions) {
      const rec = raw as unknown as Record<string, unknown>;
      let ex: unknown = rec['execute'];
      if (Array.isArray(ex)) {
        const first = ex.length > 0 ? ex[0] : undefined;
        if (first && typeof first === 'object' && !Array.isArray(first)) {
          rec['execute'] = first;
          changed = true;
          ex = first;
        } else {
          const g = typeof rec['guid'] === 'string' ? rec['guid'] : '';
          if (g.length > 0) droppedActionGuids.add(g);
          changed = true;
          continue;
        }
      }
      if (!ex || typeof ex !== 'object' || Array.isArray(ex)) {
        const g = typeof rec['guid'] === 'string' ? rec['guid'] : '';
        if (g.length > 0) droppedActionGuids.add(g);
        changed = true;
        continue;
      }
      nextActions.push(raw as ActionDefinition);
    }

    for (const ctrl of this.project.controller ?? []) {
      for (const inp of ctrl.inputs ?? []) {
        const r = inp as unknown as Record<string, unknown>;
        const legacyA = r['action'];
        let list: string[] = Array.isArray(r['actions'])
          ? (r['actions'] as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 0)
          : [];
        if (typeof legacyA === 'string' && legacyA.length > 0 && !list.includes(legacyA)) {
          list.push(legacyA);
          delete r['action'];
          changed = true;
        }
        list = list.filter(g => !droppedActionGuids.has(g));
        r['actions'] = list;
        if (r['target'] !== undefined) {
          delete r['target'];
          changed = true;
        }
        if (r['context'] !== undefined) {
          delete r['context'];
          changed = true;
        }
        const p = r['params'];
        if (p && typeof p === 'object' && !Array.isArray(p) && list.length > 0) {
          const act = nextActions.find(a => a.guid === list[0]);
          const exec = act?.execute as unknown as Record<string, unknown> | undefined;
          if (exec && exec['type'] === 'intent') {
            const prevP =
              typeof exec['params'] === 'object' && exec['params'] !== null && !Array.isArray(exec['params'])
                ? (exec['params'] as Record<string, unknown>)
                : {};
            exec['params'] = { ...prevP, ...(p as Record<string, unknown>) };
            delete r['params'];
            changed = true;
          } else {
            delete r['params'];
            changed = true;
          }
        }
      }
    }

    if (nextActions.length !== rawActions.length) {
      changed = true;
    }
    this.project.actions = nextActions;
    return changed;
  }

  /**
   * Normalize pulse YAML: legacy top-level `pulses` array and inline `slots[].actions` →
   * `pulses.setups` + `pulses.buckets` with slot `bucket` references.
   */
  private _normalizePulsesAfterLoad(): boolean {
    if (!this.project) return false;
    const raw = this.project.pulses as unknown;
    if (raw === undefined || raw === null) return false;

    let changed = false;
    let config: PulsesConfig;

    if (Array.isArray(raw)) {
      config = { setups: raw as PulseSetup[], buckets: [] };
      changed = true;
    } else if (typeof raw === 'object') {
      const rec = raw as Record<string, unknown>;
      const setups = Array.isArray(rec['setups']) ? (rec['setups'] as PulseSetup[]) : [];
      const buckets = Array.isArray(rec['buckets']) ? (rec['buckets'] as PulseBucket[]) : [];
      if (!Array.isArray(rec['setups']) || !Array.isArray(rec['buckets'])) {
        changed = true;
      }
      config = { setups, buckets };
      const syncRaw = rec['sync'];
      if (syncRaw !== undefined && typeof syncRaw === 'object' && !Array.isArray(syncRaw)) {
        config.sync = syncRaw as PulseSyncYamlConfig;
      }
    } else {
      return false;
    }

    for (const setup of config.setups) {
      for (const slot of setup.slots ?? []) {
        const legacy = slot as unknown as Record<string, unknown>;
        const legacyActions = legacy['actions'];
        if (!Array.isArray(legacyActions)) continue;
        const actions = legacyActions.filter((x): x is string => typeof x === 'string' && x.length > 0);
        const bucketGuid = `bucket-${randomUUID()}`;
        config.buckets.push({ guid: bucketGuid, actions });
        slot.bucket = bucketGuid;
        delete legacy['actions'];
        changed = true;
      }
    }

    if (changed || this.project.pulses !== config) {
      this.project.pulses = config;
    }
    return changed;
  }

  /**
   * YAML or hand-edited projects may list `animations` without the paired runner `action` rows
   * the UI creates via graph commands. Without them, controllers hide animations from the perform list.
   */
  private _ensureAnimationCompanionActions(): boolean {
    if (!this.project) return false;
    const anims = this.project.animations ?? [];
    if (anims.length === 0) return false;
    const actions = [...(this.project.actions ?? [])];
    let changed = false;
    for (const anim of anims) {
      const guid = typeof anim.guid === 'string' ? anim.guid : '';
      if (!guid) continue;
      const animName =
        typeof anim.name === 'string' && anim.name.length > 0 ? anim.name : guid;
      const idx = actions.findIndex(a => a.guid === guid);
      const existing = idx >= 0 ? actions[idx] : undefined;
      if (existing !== undefined && isCompanionAnimationRunnerAction(existing, guid)) {
        continue;
      }
      const existingName =
        typeof existing?.name === 'string' ? existing.name.trim() : '';
      const companionName =
        existingName.length > 0 ? existingName : `Run ${animName}`;
      const companion: ActionDefinition = {
        guid,
        name: companionName,
        execute: { type: 'animation', guid },
      };
      if (idx >= 0) {
        actions[idx] = companion;
      } else {
        actions.push(companion);
      }
      changed = true;
    }
    if (changed) {
      this.project.actions = actions;
    }
    return changed;
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
    for (const anim of this.project.animations ?? []) {
      ensureGuid(anim as unknown as Record<string, unknown>, 'animation');
    }
    for (const snap of this.project.snapshots ?? []) {
      ensureGuid(snap as unknown as Record<string, unknown>, 'snapshot');
      sanitizeSnapshotStoredRow(snap);
    }
    for (const setup of this.project.pulses?.setups ?? []) {
      ensureGuid(setup as unknown as Record<string, unknown>, 'pulse');
    }
    for (const bucket of this.project.pulses?.buckets ?? []) {
      ensureGuid(bucket as unknown as Record<string, unknown>, 'bucket');
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
    const knownTopLevel = new Set([
      'name',
      'zone-to-renderer',
      'intents',
      'scenes',
      'actions',
      'animations',
      'pulses',
      'activeSceneGuid',
      'activePulseGuid',
      'snapshots',
      'zones',
      'controller',
    ]);
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

  /**
   * Apply a dot-path patch (e.g. `params.dmxBaseChannel`, `name`, `range`) to a fixture
   * instance by guid and persist. Position moves go through `updateFixtures` instead, which
   * handles zone-relative `location` recomputation. Returns the serialized instance or null
   * when the guid is unknown.
   */
  patchFixtureByGuid(
    guid: string,
    patch: Record<string, unknown>,
    remove: string[] = [],
  ): Record<string, unknown> | null {
    for (const zone of this.runtimeZones) {
      const index = zone.fixtures.findIndex((fixture) => fixture.guid === guid);
      if (index < 0) continue;
      const current = zone.fixtures[index]!;
      const patched = applyDotPathPatch(
        this.cloneFixtureInstance(current) as unknown as Record<string, unknown>,
        patch,
        remove,
      );
      patched['guid'] = guid;
      zone.fixtures[index] = patched as unknown as FixtureInstance;
      this.project!.zones = this.runtimeZones.map((z) => ({
        ...z,
        fixtures: z.fixtures.map((fixture) => this.cloneFixtureInstance(fixture)),
      }));
      this._scheduleSave();
      return this.serializeFixtureInstance(zone.fixtures[index]!);
    }
    return null;
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
    for (const anim of this.project?.animations ?? []) {
      add('animation', anim.guid, { ...(anim as unknown as Record<string, unknown>) });
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
    const knownTopLevel = new Set([
      'name',
      'zone-to-renderer',
      'intents',
      'scenes',
      'actions',
      'animations',
      'pulses',
      'activeSceneGuid',
      'activePulseGuid',
      'snapshots',
      'zones',
      'controller',
    ]);
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
    if (this.project) {
      if (scene.guid) {
        this.project.activeSceneGuid = scene.guid;
      } else {
        delete this.project.activeSceneGuid;
      }
      if (persistDurable) {
        this._scheduleSave();
      }
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

  getActiveSceneGuid(): string | null {
    const scenes = this.project?.scenes;
    if (!scenes || scenes.length === 0) return null;

    const stored = this.project?.activeSceneGuid;
    if (typeof stored === 'string' && stored.length > 0) {
      const byGuid = scenes.find(s => s.guid === stored);
      if (byGuid?.guid) {
        if (this.activeSceneName !== byGuid.name) {
          this.activeSceneName = byGuid.name;
        }
        return byGuid.guid;
      }
    }

    if (this.activeSceneName) {
      const byName = scenes.find(s => s.name === this.activeSceneName);
      if (byName?.guid) {
        if (this.project && this.project.activeSceneGuid !== byName.guid) {
          this.project.activeSceneGuid = byName.guid;
        }
        return byName.guid;
      }
    }

    return scenes[0]?.guid ?? null;
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

  getAnimationsWirePayload(): AnimationDefinition[] {
    return this.project?.animations ?? [];
  }

  getSnapshotsWirePayload(): SnapshotDefinition[] {
    return this.project?.snapshots ?? [];
  }

  getSnapshotByGuid(guid: string): SnapshotDefinition | undefined {
    return (this.project?.snapshots ?? []).find(s => s.guid === guid);
  }

  getAnimationByGuid(guid: string): AnimationDefinition | undefined {
    return (this.project?.animations ?? []).find(a => a.guid === guid);
  }

  getPulseSetup(guid: string): PulseSetup | undefined {
    return (this.project?.pulses?.setups ?? []).find(p => p.guid === guid);
  }

  getPulseBucket(guid: string): PulseBucket | undefined {
    return (this.project?.pulses?.buckets ?? []).find(b => b.guid === guid);
  }

  ensurePulsesConfig(): PulsesConfig {
    if (!this.project) {
      throw new Error('[project] No project loaded — call useProject() first');
    }
    if (!this.project.pulses) {
      this.project.pulses = { setups: [], buckets: [] };
    }
    return this.project.pulses;
  }

  getPulsesWirePayload(): PulsesConfig {
    const raw = this.project?.pulses;
    if (!raw) {
      return { setups: [], buckets: [] };
    }
    return cloneRecord(raw as unknown as Record<string, unknown>) as unknown as PulsesConfig;
  }

  getPulseSlotActionGuids(setup: PulseSetup, slotIdx: number): string[] {
    const slot = setup.slots[slotIdx];
    if (!slot?.bucket) return [];
    return [...(this.getPulseBucket(slot.bucket)?.actions ?? [])];
  }

  getActivePulseGuid(): string | undefined {
    return this.project?.activePulseGuid;
  }

  setActivePulseGuid(guid: string | undefined): void {
    if (!this.project) return;
    if (guid === this.project.activePulseGuid) return;
    if (guid === undefined) {
      delete this.project.activePulseGuid;
    } else {
      this.project.activePulseGuid = guid;
    }
    this._scheduleSave();
  }

  /**
   * Patch fields on an animation definition in-memory only — no graph event, no broadcast.
   * Used for operational state (e.g. timescale) that should survive restarts but not be fanned out.
   */
  patchAnimationFields(guid: string, patch: Record<string, unknown>): void {
    const anim = (this.project?.animations ?? []).find(a => a.guid === guid);
    if (anim) Object.assign(anim, patch);
  }

  /**
   * Mark project dirty after in-place animation definition mutations.
   * No graph event/broadcast; only schedules durable save.
   */
  touchAnimations(): void {
    this._scheduleSave();
  }

  touchPulses(): void {
    this._scheduleSave();
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
    const snapshots = this.project.snapshots ?? [];
    const inputs = match?.inputs ?? [];
    Logger.info(`[project] buildControllerConfig(${guid}): ${this.runtimeZones.length} zone(s), ${intents.length} intent(s), ${scenes.length} scene(s)`);
    return {
      projectName: this.project.name,
      zoneToRenderer: this.project['zone-to-renderer'] ?? {},
      zones: this.runtimeZones.map((z) => this.serializeZone(z)),
      intents,
      scenes,
      actions,
      snapshots,
      inputs,
      activeSceneGuid: this.getActiveSceneGuid(),
      ...passThrough,
    };
  }
}
