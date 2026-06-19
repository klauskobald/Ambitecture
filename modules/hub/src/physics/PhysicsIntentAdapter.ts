import type { ProjectManager, ControllerIntent } from '../ProjectManager';
import type { RuntimeIntentStore } from '../RuntimeIntentStore';
import type { RuntimeUpdateDispatcher } from '../RuntimeUpdateDispatcher';
import type { RuntimeUpdate } from '../RuntimeProtocol';
import { Logger } from '../Logger';
import { PhysicsEngine } from './PhysicsEngine';
import type { PhysicsBody } from './PhysicsBody';
import { vec3, type Vec3 } from './vec3';
import type { ConnectorRecord, ConnectorKind } from './connectors/ConnectorBase';

const PHYSICS_SOURCE = 'hub:physics';
const DRAG_RELEASE_MS = 140;
const DEFAULT_MASS = 1;
const DEFAULT_DRAG = 0;

type Aabb = [number, number, number, number, number, number];

/**
 * The intent-aware "consumer" half of the physics system. It owns no physics math: it builds bodies
 * and connectors from the project, wakes the engine when a connected intent is moved by anything other
 * than the engine itself, clamps committed positions to the stage bounds in the engine's commit hook,
 * and streams the results as transient `runtime:update`s (never durable graph state).
 */
export class PhysicsIntentAdapter {
  private bounds: Aabb | null = null;
  private readonly dragTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private participants = new Set<string>();

  constructor(
    private readonly projectManager: ProjectManager,
    private readonly runtimeIntentStore: RuntimeIntentStore,
    private readonly runtimeUpdateDispatcher: RuntimeUpdateDispatcher,
    private readonly engine: PhysicsEngine,
  ) {}

  start(): void {
    this.stop();
    this.engine.onCommit((id, position, velocity) => this.commit(id, position, velocity));
    this.runtimeUpdateDispatcher.setUpdateListener(updates => this.onRuntimeUpdates(updates));
    this.rebuild();
  }

  stop(): void {
    this.engine.stop();
    this.engine.clear();
    for (const timer of this.dragTimers.values()) clearTimeout(timer);
    this.dragTimers.clear();
    this.participants.clear();
  }

  /** Rebuild bodies, connectors and bounds from the current project. Idempotent; safe to call on any graph change. */
  rebuild(): void {
    this.engine.clear();
    this.bounds = this.computeBounds();

    const bodies = new Map<string, PhysicsBody>();
    for (const intent of this.projectManager.getActiveSceneIntents()) {
      if (!intent.guid || intent.class === 'master') continue;
      const effective = this.runtimeIntentStore.getEffectiveIntent(intent.guid) ?? intent;
      const body = this.toBody(intent.guid, effective);
      bodies.set(intent.guid, body);
      this.engine.setBody(body);
    }

    const connectors = this.buildConnectors(bodies);
    this.engine.setConnectors(connectors);
    this.participants = new Set(connectors.flatMap(c => [c.aId, c.bId]));
    Logger.info(`[physics] rebuilt: ${bodies.size} body(ies), ${connectors.length} connector(s)`);
  }

  private toBody(guid: string, intent: ControllerIntent): PhysicsBody {
    const position = this.toVec3(intent.position);
    return {
      id: guid,
      position,
      velocity: vec3.zero(),
      prevPosition: vec3.clone(position),
      mass: this.readNumber(intent.mass, DEFAULT_MASS),
      drag: this.readNumber(intent.drag, DEFAULT_DRAG),
      pinned: false,
    };
  }

  private buildConnectors(bodies: Map<string, PhysicsBody>): ConnectorRecord[] {
    const records: ConnectorRecord[] = [];
    for (const entity of this.projectManager.getConnectors()) {
      const aId = entity.aGuid;
      const bId = entity.bGuid;
      const a = bodies.get(aId);
      const b = bodies.get(bId);
      if (!a || !b) continue;
      const restLength = typeof entity.restLength === 'number' && entity.restLength > 0
        ? entity.restLength
        : vec3.distance(a.position, b.position);
      const restDir = vec3.normalize(vec3.sub(b.position, a.position));
      records.push({
        guid: entity.guid,
        kind: entity.kind as ConnectorKind,
        aId,
        bId,
        restLength,
        restDir,
        params: entity.params ?? {},
      });
    }
    return records;
  }

  /** Called for every runtime update; an external (non-physics) move pins the body and wakes the solver. */
  private onRuntimeUpdates(updates: RuntimeUpdate[]): void {
    let woke = false;
    for (const update of updates) {
      if (update.entityType !== 'intent' || update.source === PHYSICS_SOURCE) continue;
      if (!this.participants.has(update.guid)) continue;
      const position = update.patch?.['position'];
      if (!Array.isArray(position) || position.length !== 3) continue;
      const body = this.engine.getBody(update.guid);
      if (!body) continue;
      body.position = this.toVec3(position);
      body.velocity = vec3.zero();
      this.pin(body);
      woke = true;
    }
    if (woke) this.engine.wake();
  }

  private pin(body: PhysicsBody): void {
    body.pinned = true;
    const existing = this.dragTimers.get(body.id);
    if (existing) clearTimeout(existing);
    this.dragTimers.set(body.id, setTimeout(() => {
      body.pinned = false;
      this.dragTimers.delete(body.id);
      this.engine.wake();
    }, DRAG_RELEASE_MS));
  }

  private commit(id: string, position: Vec3, velocity: Vec3): { position: Vec3; velocity: Vec3 } {
    const clamped = this.clampToBounds(position, velocity);
    const update: RuntimeUpdate = {
      entityType: 'intent',
      guid: id,
      patch: { position: clamped.position },
      source: PHYSICS_SOURCE,
    };
    this.runtimeUpdateDispatcher.dispatch([update], undefined, Date.now());
    return clamped;
  }

  /** Clamp to the stage AABB; a clamped axis zeroes that velocity component (a wall absorbs the bang). */
  private clampToBounds(position: Vec3, velocity: Vec3): { position: Vec3; velocity: Vec3 } {
    const b = this.bounds;
    if (!b) return { position, velocity };
    const axis = (p: number, v: number, min: number, max: number): [number, number] => {
      if (p < min) return [min, 0];
      if (p > max) return [max, 0];
      return [p, v];
    };
    const [x, vx] = axis(position[0], velocity[0], b[0], b[3]);
    const [y, vy] = axis(position[1], velocity[1], b[1], b[4]);
    const [z, vz] = axis(position[2], velocity[2], b[2], b[5]);
    return { position: [x, y, z], velocity: [vx, vy, vz] };
  }

  private computeBounds(): Aabb | null {
    let bounds: Aabb | null = null;
    for (const raw of this.projectManager.getSerializedRuntimeZones()) {
      if (!raw || typeof raw !== 'object') continue;
      const bbox = (raw as Record<string, unknown>)['boundingBox'];
      if (!Array.isArray(bbox) || bbox.length !== 6) continue;
      const box: Aabb = [
        Number(bbox[0]), Number(bbox[1]), Number(bbox[2]),
        Number(bbox[3]), Number(bbox[4]), Number(bbox[5]),
      ];
      if (!bounds) {
        bounds = box;
        continue;
      }
      bounds = [
        Math.min(bounds[0], box[0]), Math.min(bounds[1], box[1]), Math.min(bounds[2], box[2]),
        Math.max(bounds[3], box[3]), Math.max(bounds[4], box[4]), Math.max(bounds[5], box[5]),
      ];
    }
    return bounds;
  }

  private toVec3(value: unknown): Vec3 {
    if (Array.isArray(value) && value.length === 3) {
      return [Number(value[0]), Number(value[1]), Number(value[2])];
    }
    return vec3.zero();
  }

  private readNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }
}
