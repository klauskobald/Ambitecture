import { GraphDelta, IntentRecord, Position3, SceneRecord, ZoneRecord } from './GraphProtocol';

export interface MovementBounds {
  center: Position3;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

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
  if (!Array.isArray(value) || value.length !== 3) {
    return null;
  }
  const x = finiteNumber(value[0]);
  const y = finiteNumber(value[1]);
  const z = finiteNumber(value[2]);
  return x === null || y === null || z === null ? null : [x, y, z];
}

function toBoundingBox(value: unknown): [number, number, number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 6) {
    return undefined;
  }
  const box = value.map(finiteNumber);
  if (box.some(item => item === null)) {
    return undefined;
  }
  return box as [number, number, number, number, number, number];
}

function setAtDotPath(target: Record<string, unknown>, dotKey: string, value: unknown): void {
  const segments = dotKey.split('.');
  let cursor = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    const existing = cursor[segment];
    if (!isRecord(existing)) {
      cursor[segment] = {};
    }
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
    if (!isRecord(existing)) {
      return;
    }
    cursor = existing;
  }
  delete cursor[segments[segments.length - 1]!];
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function applyPatch(base: Record<string, unknown>, patch: Record<string, unknown> = {}, remove: string[] = []): Record<string, unknown> {
  const next = cloneRecord(base);
  for (const [key, value] of Object.entries(patch)) {
    setAtDotPath(next, key, value);
  }
  for (const key of remove) {
    removeAtDotPath(next, key);
  }
  return next;
}

function sceneIntentGuid(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return isRecord(value) ? stringValue(value['guid']) : '';
}

function toSceneRecord(value: unknown): SceneRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const name = stringValue(value['name']);
  if (!name) {
    return null;
  }
  const guid = stringValue(value['guid']);
  const rawIntents = Array.isArray(value['intents']) ? value['intents'] : [];
  return {
    guid,
    name,
    intents: rawIntents.map(sceneIntentGuid).filter(Boolean),
  };
}

function toIntentRecord(value: unknown): IntentRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const guid = stringValue(value['guid']);
  if (!guid) {
    return null;
  }
  const position = toPosition3(value['position']);
  return {
    ...value,
    guid,
    ...(typeof value['name'] === 'string' ? { name: value['name'] } : {}),
    ...(position ? { position } : {}),
  };
}

function toZoneRecord(value: unknown): ZoneRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const name = stringValue(value['name']);
  if (!name) {
    return null;
  }
  const guid = stringValue(value['guid']);
  const boundingBox = toBoundingBox(value['boundingBox']);
  return {
    ...(guid ? { guid } : {}),
    name,
    ...(boundingBox ? { boundingBox } : {}),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export class ProjectGraph {
  private projectName = '';
  private revision = 0;
  private controllerGuid = '';
  private activeSceneName: string | null = null;
  private readonly intents = new Map<string, IntentRecord>();
  private readonly scenes = new Map<string, SceneRecord>();
  private zones: ZoneRecord[] = [];

  applyGraphInit(payload: unknown): void {
    if (!isRecord(payload)) {
      return;
    }

    this.projectName = stringValue(payload['projectName']);
    this.revision = finiteNumber(payload['revision']) ?? this.revision;
    this.controllerGuid = stringValue(payload['controllerGuid']);
    this.activeSceneName = typeof payload['activeSceneName'] === 'string' ? payload['activeSceneName'] : null;

    this.intents.clear();
    for (const rawIntent of Array.isArray(payload['intents']) ? payload['intents'] : []) {
      const intent = toIntentRecord(rawIntent);
      if (intent) {
        this.intents.set(intent.guid, intent);
      }
    }

    this.scenes.clear();
    for (const rawScene of Array.isArray(payload['scenes']) ? payload['scenes'] : []) {
      const scene = toSceneRecord(rawScene);
      if (scene) {
        this.scenes.set(scene.name, scene);
      }
    }

    this.zones = (Array.isArray(payload['zones']) ? payload['zones'] : [])
      .map(toZoneRecord)
      .filter((zone): zone is ZoneRecord => zone !== null);
  }

  applyGraphDelta(payload: unknown): void {
    const deltas = Array.isArray(payload) ? payload : [payload];
    for (const rawDelta of deltas) {
      if (!isRecord(rawDelta)) {
        continue;
      }
      const delta = rawDelta as unknown as GraphDelta;
      const guid = stringValue(delta.guid);
      const entityType = stringValue(delta.entityType);
      const op = stringValue(delta.op);
      if (!guid || !entityType || !op) {
        continue;
      }

      switch (entityType) {
        case 'intent':
          this.applyIntentDelta(guid, op, delta);
          break;
        case 'scene':
          this.applySceneDelta(guid, op, delta);
          break;
        case 'project':
          this.applyProjectDelta(delta);
          break;
        case 'zone':
          this.applyZoneDelta(guid, op, delta);
          break;
        default:
          break;
      }

      this.revision = finiteNumber(delta.revision) ?? this.revision;
    }
  }

  getProjectName(): string {
    return this.projectName;
  }

  getActiveSceneName(): string | null {
    return this.activeSceneName;
  }

  getIntent(guid: string): IntentRecord | null {
    return this.intents.get(guid) ?? null;
  }

  getIntentPosition(guid: string): Position3 | null {
    return this.getIntent(guid)?.position ?? null;
  }

  isIntentInActiveScene(guid: string): boolean {
    if (!this.activeSceneName) {
      return false;
    }
    const scene = this.scenes.get(this.activeSceneName);
    return scene?.intents.includes(guid) ?? false;
  }

  patchIntentPosition(guid: string, position: Position3): void {
    const current = this.intents.get(guid);
    if (!current) {
      return;
    }
    this.intents.set(guid, { ...current, position });
  }

  getMovementBoundsForIntent(guid: string): MovementBounds | null {
    const position = this.getIntentPosition(guid);
    if (!position) {
      return null;
    }
    const zone = this.zones.find(item => {
      if (!item.boundingBox) {
        return false;
      }
      const [x1, , z1, x2, , z2] = item.boundingBox;
      const isWithinX = position[0] >= x1 && position[0] <= x2;
      const isWithinZ = position[2] >= z1 && position[2] <= z2;
      return isWithinX && isWithinZ;
    });

    if (!zone?.boundingBox) {
      return {
        center: position,
        minX: position[0] - 1,
        maxX: position[0] + 1,
        minZ: position[2] - 1,
        maxZ: position[2] + 1,
      };
    }

    const [minX, , minZ, maxX, , maxZ] = zone.boundingBox;
    return {
      center: position,
      minX,
      maxX,
      minZ,
      maxZ,
    };
  }

  private applyIntentDelta(guid: string, op: string, delta: GraphDelta): void {
    if (op === 'remove') {
      this.intents.delete(guid);
      return;
    }
    const base = delta.value && isRecord(delta.value)
      ? delta.value
      : this.intents.get(guid) ?? { guid };
    const next = delta.patch || delta.remove ? applyPatch(base, delta.patch, delta.remove) : cloneRecord(base);
    next['guid'] = guid;
    const intent = toIntentRecord(next);
    if (intent) {
      this.intents.set(guid, intent);
    }
  }

  private applySceneDelta(guid: string, op: string, delta: GraphDelta): void {
    if (op === 'remove') {
      for (const [name, scene] of this.scenes) {
        if (scene.guid === guid) {
          this.scenes.delete(name);
          return;
        }
      }
      return;
    }
    const current = [...this.scenes.values()].find(scene => scene.guid === guid);
    const base = delta.value && isRecord(delta.value)
      ? delta.value
      : current
        ? { guid: current.guid, name: current.name, intents: current.intents.map(intentGuid => ({ guid: intentGuid })) }
        : { guid };
    const next = delta.patch || delta.remove ? applyPatch(base, delta.patch, delta.remove) : cloneRecord(base);
    const scene = toSceneRecord(next);
    if (scene) {
      if (current && current.name !== scene.name) {
        this.scenes.delete(current.name);
      }
      this.scenes.set(scene.name, scene);
    }
  }

  private applyProjectDelta(delta: GraphDelta): void {
    if (delta.patch && typeof delta.patch['activeSceneName'] === 'string') {
      this.activeSceneName = delta.patch['activeSceneName'];
    }
  }

  private applyZoneDelta(guid: string, op: string, delta: GraphDelta): void {
    if (op === 'remove') {
      this.zones = this.zones.filter(zone => zone.guid !== guid);
      return;
    }
    const zone = toZoneRecord(delta.value);
    if (!zone) {
      return;
    }
    this.zones = this.zones.filter(item => item.guid !== guid);
    this.zones.push(zone);
  }
}

export function boundedLoopPosition(bounds: MovementBounds, radius: number, angleRadians: number): Position3 {
  const usableRadiusX = Math.min(radius, Math.max((bounds.maxX - bounds.minX) / 2, 0));
  const usableRadiusZ = Math.min(radius, Math.max((bounds.maxZ - bounds.minZ) / 2, 0));
  const centerX = clamp(bounds.center[0], bounds.minX + usableRadiusX, bounds.maxX - usableRadiusX);
  const centerZ = clamp(bounds.center[2], bounds.minZ + usableRadiusZ, bounds.maxZ - usableRadiusZ);
  const x = clamp(centerX + Math.cos(angleRadians) * usableRadiusX, bounds.minX, bounds.maxX);
  const z = clamp(centerZ + Math.sin(angleRadians) * usableRadiusZ, bounds.minZ, bounds.maxZ);
  return [x, bounds.center[1], z];
}
