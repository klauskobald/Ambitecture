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
const DEFAULT_MASS = 1;
const DEFAULT_DRAG = 0;
const ANCHOR_PREFIX = '__drag-anchor:';
const SPRING_PREFIX = '__drag-spring:';

type Aabb = [number, number, number, number, number, number];

/** Temporary mouse/animation drag link tuning (from `system.yml → physics`). */
export interface DragConfig {
  /** Pull strength of the critically-damped drag link (higher = tighter follow). */
  stiffness: number;
  /** Cap on the drag force magnitude — bounds the impulse propagated into the connection chain. */
  maxForce: number;
}

/** A live drag: a fixed anchor body the intent is sprung to, and the temp spring connecting them. */
interface ActiveDrag {
  intentGuid: string;
  anchorId: string;
  springId: string;
  anchorPos: Vec3;
}

/**
 * The intent-aware "consumer" half of the physics system. It owns no physics math: it builds bodies
 * and connectors from the project, clamps committed positions to the stage bounds, and streams results
 * as transient `runtime:update`s. Dragging an intent (by mouse or animation) is modelled as a temporary
 * stiff spring from a **fixed anchor** (the mouse/target point) to the intent, so the intent's mass
 * governs how it lags and connected intents follow via real forces; releasing drops the anchor+spring
 * and the intent flies on with its momentum.
 */
export class PhysicsIntentAdapter {
  private bounds: Aabb | null = null;
  private readonly activeDrags = new Map<string, ActiveDrag>();

  constructor(
    private readonly projectManager: ProjectManager,
    private readonly runtimeIntentStore: RuntimeIntentStore,
    private readonly runtimeUpdateDispatcher: RuntimeUpdateDispatcher,
    private readonly engine: PhysicsEngine,
    private readonly dragConfig: DragConfig,
  ) { }

  start(): void {
    this.stop();
    this.engine.onCommit((id, position, velocity) => this.commit(id, position, velocity));
    this.runtimeUpdateDispatcher.setUpdateInterceptor(updates => this.intercept(updates));
    this.rebuild();
  }

  stop(): void {
    this.engine.stop();
    this.engine.clear();
    this.activeDrags.clear();
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
    this.reestablishActiveDrags(bodies);
    Logger.info(`[physics] rebuilt: ${bodies.size} body(ies), ${connectors.length} connector(s)`);
  }

  /** A graph change rebuilds bodies/connectors; re-create any in-progress drag anchors + springs on top. */
  private reestablishActiveDrags(bodies: Map<string, PhysicsBody>): void {
    for (const drag of [...this.activeDrags.values()]) {
      if (!bodies.has(drag.intentGuid)) {
        this.clearDrag(drag.intentGuid);
        continue;
      }
      this.engine.setBody(this.makeAnchor(drag.anchorId, drag.anchorPos));
      this.engine.addConnector(this.makeDragSpring(drag.springId, drag.anchorId, drag.intentGuid));
    }
  }

  private toBody(guid: string, intent: ControllerIntent): PhysicsBody {
    const position = this.toVec3(intent.position);
    // Mass must be > 0 — a zero/invalid mass would make the body immovable (infinite inertia). Default to 1.
    const mass = this.readNumber(intent.mass, DEFAULT_MASS);
    return {
      id: guid,
      position,
      velocity: vec3.zero(),
      prevPosition: vec3.clone(position),
      mass: mass > 0 ? mass : DEFAULT_MASS,
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

  /**
   * Handle the perform-drag lifecycle carried on runtime updates. `drag:'move'` grabs/holds the intent
   * on a fixed physics anchor (so its mass governs lag and connected intents follow); `drag:'end'`
   * releases it on pointer-up — exactly when the user lets go, never on a timeout. Both are consumed so
   * the raw position never reaches renderers (the engine owns the dragged intent's rendered position).
   * Everything else — physics output, edit-mode placement, animations, non-intent updates — passes through.
   */
  private intercept(updates: RuntimeUpdate[]): RuntimeUpdate[] {
    let woke = false;
    const passthrough: RuntimeUpdate[] = [];
    for (const update of updates) {
      if (update.entityType !== 'intent' || update.source === PHYSICS_SOURCE || !update.drag) {
        passthrough.push(update);
        continue;
      }
      if (update.drag === 'end') {
        this.clearDrag(update.guid);
        woke = true;
        continue;
      }
      const position = update.patch?.['position'];
      if (Array.isArray(position) && position.length === 3 && this.engine.getBody(update.guid)) {
        this.driveAnchor(update.guid, this.toVec3(position));
        woke = true;
      } else {
        passthrough.push(update);
      }
    }
    if (woke) this.engine.wake();
    return passthrough;
  }

  /** Move (or create) the fixed anchor the dragged intent is sprung to. Persists until an explicit release. */
  private driveAnchor(intentGuid: string, anchorPos: Vec3): void {
    let drag = this.activeDrags.get(intentGuid);
    if (!drag) {
      const anchorId = ANCHOR_PREFIX + intentGuid;
      const springId = SPRING_PREFIX + intentGuid;
      drag = { intentGuid, anchorId, springId, anchorPos };
      this.activeDrags.set(intentGuid, drag);
      this.engine.setBody(this.makeAnchor(anchorId, anchorPos));
      this.engine.addConnector(this.makeDragSpring(springId, anchorId, intentGuid));
    } else {
      drag.anchorPos = anchorPos;
      const anchor = this.engine.getBody(drag.anchorId);
      if (anchor) anchor.position = anchorPos;
    }
  }

  /** Release: drop the anchor body + drag link; the intent keeps its velocity and flies on. */
  private clearDrag(intentGuid: string): void {
    const drag = this.activeDrags.get(intentGuid);
    if (!drag) return;
    this.engine.removeConnector(drag.springId);
    this.engine.removeBody(drag.anchorId);
    this.activeDrags.delete(intentGuid);
    this.engine.wake();
  }

  /** Fixed anchor body: pinned (immovable, so the intent cannot affect it — the requested "A is fixed"). */
  private makeAnchor(anchorId: string, position: Vec3): PhysicsBody {
    return {
      id: anchorId,
      position: vec3.clone(position),
      velocity: vec3.zero(),
      prevPosition: vec3.clone(position),
      mass: 1,
      drag: 0,
      pinned: true,
    };
  }

  private makeDragSpring(springId: string, anchorId: string, intentGuid: string): ConnectorRecord {
    return {
      guid: springId,
      kind: 'drag',
      aId: anchorId,
      bId: intentGuid,
      restLength: 0,
      params: { stiffness: this.dragConfig.stiffness, maxForce: this.dragConfig.maxForce },
    };
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
