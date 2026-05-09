// Lightweight controller-side replica of the hub's project graph.
// Stores entities by stable GUID, applies graph:init / graph:delta, and
// exposes simple lookup helpers. No subscription / no diffing — extend the
// StarterController hooks if you need reactive UI.

import {
  ActionRecord,
  GraphDelta,
  IntentRecord,
  Position3,
  SceneRecord,
  ZoneRecord,
} from './GraphProtocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toPosition3(value: unknown): Position3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const x = finiteNumber(value[0]);
  const y = finiteNumber(value[1]);
  const z = finiteNumber(value[2]);
  return x === null || y === null || z === null ? null : [x, y, z];
}

function toBoundingBox(value: unknown): [number, number, number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 6) return undefined;
  const box = value.map(finiteNumber);
  if (box.some(item => item === null)) return undefined;
  return box as [number, number, number, number, number, number];
}

function setAtDotPath(target: Record<string, unknown>, dotKey: string, value: unknown): void {
  const segments = dotKey.split('.');
  let cursor = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    const existing = cursor[segment];
    if (!isRecord(existing)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]!] = value;
}

function removeAtDotPath(target: Record<string, unknown>, dotKey: string): void {
  const segments = dotKey.split('.');
  let cursor = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    const existing = cursor[segment];
    if (!isRecord(existing)) return;
    cursor = existing;
  }
  delete cursor[segments[segments.length - 1]!];
}

function applyPatch(
  base: Record<string, unknown>,
  patch: Record<string, unknown> = {},
  remove: string[] = [],
): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) setAtDotPath(next, key, value);
  for (const key of remove) removeAtDotPath(next, key);
  return next;
}

function sceneIntentGuid(value: unknown): string {
  if (typeof value === 'string') return value;
  return isRecord(value) ? stringValue(value['guid']) : '';
}

function toSceneRecord(value: unknown): SceneRecord | null {
  if (!isRecord(value)) return null;
  const guid = stringValue(value['guid']);
  if (!guid) return null;
  const rawIntents = Array.isArray(value['intents']) ? value['intents'] : [];
  return {
    guid,
    name: stringValue(value['name']),
    intents: rawIntents.map(sceneIntentGuid).filter(Boolean),
  };
}

function toIntentRecord(value: unknown): IntentRecord | null {
  if (!isRecord(value)) return null;
  const guid = stringValue(value['guid']);
  if (!guid) return null;
  const position = toPosition3(value['position']);
  return {
    ...value,
    guid,
    ...(typeof value['name'] === 'string' ? { name: value['name'] } : {}),
    ...(position ? { position } : {}),
  };
}

function toActionRecord(value: unknown): ActionRecord | null {
  if (!isRecord(value)) return null;
  const guid = stringValue(value['guid']);
  if (!guid) return null;
  return {
    ...value,
    guid,
    ...(typeof value['name'] === 'string' ? { name: value['name'] } : {}),
  };
}

function toZoneRecord(value: unknown): ZoneRecord | null {
  if (!isRecord(value)) return null;
  const guid = stringValue(value['guid']);
  if (!guid) return null;
  const boundingBox = toBoundingBox(value['boundingBox']);
  return {
    guid,
    name: stringValue(value['name']),
    ...(boundingBox ? { boundingBox } : {}),
  };
}

export class ProjectGraph {
  private projectName = '';
  private revision = 0;
  private activeSceneGuid: string | null = null;
  private readonly intents = new Map<string, IntentRecord>();
  private readonly scenes = new Map<string, SceneRecord>();
  private readonly actions = new Map<string, ActionRecord>();
  private readonly zones = new Map<string, ZoneRecord>();

  applyGraphInit(payload: unknown): void {
    if (!isRecord(payload)) return;

    this.projectName = stringValue(payload['projectName']);
    this.revision = finiteNumber(payload['revision']) ?? this.revision;
    this.activeSceneGuid = typeof payload['activeSceneGuid'] === 'string' ? payload['activeSceneGuid'] : null;

    this.replaceCollection(this.intents, payload['intents'], toIntentRecord);
    this.replaceCollection(this.scenes, payload['scenes'], toSceneRecord);
    this.replaceCollection(this.actions, payload['actions'], toActionRecord);
    this.replaceCollection(this.zones, payload['zones'], toZoneRecord);
  }

  applyGraphDelta(payload: unknown): void {
    const deltas = Array.isArray(payload) ? payload : [payload];
    for (const raw of deltas) {
      if (!isRecord(raw)) continue;
      const delta = raw as unknown as GraphDelta;
      const guid = stringValue(delta.guid);
      const op = stringValue(delta.op);
      const entityType = stringValue(delta.entityType);
      if (!guid || !op || !entityType) continue;

      switch (entityType) {
        case 'intent': this.applyEntityDelta(this.intents, guid, op, delta, toIntentRecord); break;
        case 'scene':  this.applyEntityDelta(this.scenes,  guid, op, delta, toSceneRecord);  break;
        case 'action': this.applyEntityDelta(this.actions, guid, op, delta, toActionRecord); break;
        case 'zone':   this.applyEntityDelta(this.zones,   guid, op, delta, toZoneRecord);   break;
        case 'project': this.applyProjectDelta(delta); break;
        default: break;
      }

      this.revision = finiteNumber(delta.revision) ?? this.revision;
    }
  }

  /**
   * Apply a runtime overlay (from `runtime:update`) to the in-memory intent.
   * Runtime overlays are transient and do not change the durable graph.
   */
  applyIntentRuntimeOverlay(guid: string, patch?: Record<string, unknown>, remove?: string[]): void {
    const current = this.intents.get(guid);
    if (!current) return;
    const next = applyPatch(current, patch, remove);
    next['guid'] = guid;
    const intent = toIntentRecord(next);
    if (intent) this.intents.set(guid, intent);
  }

  getProjectName(): string { return this.projectName; }
  getRevision(): number { return this.revision; }
  getActiveSceneGuid(): string | null { return this.activeSceneGuid; }
  getActiveScene(): SceneRecord | null { return this.activeSceneGuid ? this.scenes.get(this.activeSceneGuid) ?? null : null; }
  getActiveSceneName(): string | null { return this.getActiveScene()?.name ?? null; }

  getIntent(guid: string): IntentRecord | null { return this.intents.get(guid) ?? null; }
  getAction(guid: string): ActionRecord | null { return this.actions.get(guid) ?? null; }
  getScene(guid: string): SceneRecord | null { return this.scenes.get(guid) ?? null; }
  getZone(guid: string): ZoneRecord | null { return this.zones.get(guid) ?? null; }

  listIntents(): IntentRecord[] { return [...this.intents.values()]; }
  listActions(): ActionRecord[] { return [...this.actions.values()]; }
  listScenes(): SceneRecord[] { return [...this.scenes.values()]; }
  listZones(): ZoneRecord[] { return [...this.zones.values()]; }

  isIntentInActiveScene(guid: string): boolean {
    return this.getActiveScene()?.intents.includes(guid) ?? false;
  }

  private replaceCollection<T extends { guid: string }>(
    target: Map<string, T>,
    raw: unknown,
    coerce: (value: unknown) => T | null,
  ): void {
    target.clear();
    for (const item of Array.isArray(raw) ? raw : []) {
      const record = coerce(item);
      if (record) target.set(record.guid, record);
    }
  }

  private applyEntityDelta<T extends { guid: string }>(
    target: Map<string, T>,
    guid: string,
    op: string,
    delta: GraphDelta,
    coerce: (value: unknown) => T | null,
  ): void {
    if (op === 'remove') {
      target.delete(guid);
      return;
    }
    const base = isRecord(delta.value)
      ? delta.value
      : (target.get(guid) as Record<string, unknown> | undefined) ?? { guid };
    const next = delta.patch || delta.remove ? applyPatch(base, delta.patch, delta.remove) : base;
    next['guid'] = guid;
    const record = coerce(next);
    if (record) target.set(guid, record);
  }

  private applyProjectDelta(delta: GraphDelta): void {
    if (delta.patch && typeof delta.patch['activeSceneGuid'] === 'string') {
      this.activeSceneGuid = delta.patch['activeSceneGuid'];
    }
  }
}
