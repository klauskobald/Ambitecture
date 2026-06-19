import type { PhysicsBody } from '../PhysicsBody';
import { inverseMass } from '../PhysicsBody';
import { vec3, type Vec3 } from '../vec3';

export type ConnectorKind = 'rod' | 'spring' | 'rope' | 'drag';

/** Resolved link the solver acts on. Endpoints are body ids; geometry/tuning captured at build time. */
export interface ConnectorRecord {
  guid: string;
  kind: ConnectorKind;
  aId: string;
  bId: string;
  restLength: number;
  /** World-space unit direction (b - a) at creation; used by the rod's rotation spring. */
  restDir?: Vec3;
  params: Record<string, number>;
}

type ConnectorCtor = new (record: ConnectorRecord) => ConnectorBase;

/**
 * Base for the rod/spring/rope constraints. Each concrete kind only decides the target separation
 * (direction, length, stiffness); the shared {@link applySeparation} distributes the correction by
 * inverse mass so heavier bodies move less and pinned bodies hold still.
 */
export abstract class ConnectorBase {
  private static readonly kinds = new Map<ConnectorKind, ConnectorCtor>();

  static registerKind(kind: ConnectorKind, ctor: ConnectorCtor): void {
    ConnectorBase.kinds.set(kind, ctor);
  }

  static create(record: ConnectorRecord): ConnectorBase | null {
    const ctor = ConnectorBase.kinds.get(record.kind);
    return ctor ? new ctor(record) : null;
  }

  protected readonly restLength: number;

  constructor(protected readonly record: ConnectorRecord) {
    this.restLength = record.restLength;
  }

  get guid(): string {
    return this.record.guid;
  }

  get aId(): string {
    return this.record.aId;
  }

  get bId(): string {
    return this.record.bId;
  }

  /**
   * Soft connectors (spring) apply a force to velocities here, before position integration (semi-implicit
   * Euler → momentum, mutual, mass-weighted). Rigid connectors leave this as a no-op.
   */
  applyForce(_a: PhysicsBody, _b: PhysicsBody, _dt: number): void {}

  /**
   * Rigid connectors (rod, rope) relax their distance constraint by moving positions; the engine
   * re-derives velocity from the net move, so the correction acts as an impulse. Soft connectors no-op.
   */
  project(_a: PhysicsBody, _b: PhysicsBody): void {}

  /**
   * Apply a force of magnitude `force` along the a→b axis (positive pulls them together) as an impulse
   * to each free body's velocity, scaled by inverse mass — Newton's third law, heavier accelerates less.
   */
  protected applyAxialImpulse(a: PhysicsBody, b: PhysicsBody, dir: Vec3, force: number, dt: number): void {
    const wA = inverseMass(a);
    const wB = inverseMass(b);
    const impulse = vec3.scale(dir, force * dt);
    a.velocity = vec3.add(a.velocity, vec3.scale(impulse, wA));
    b.velocity = vec3.sub(b.velocity, vec3.scale(impulse, wB));
  }

  /**
   * Move `b - a` toward `targetDir * targetLength`, distributing the correction by inverse mass and
   * scaling by `stiffness` (1 = fully satisfy this pass). Keeps the mass-weighted centre fixed.
   */
  protected applySeparation(a: PhysicsBody, b: PhysicsBody, targetDir: Vec3, targetLength: number, stiffness: number): void {
    const wA = inverseMass(a);
    const wB = inverseMass(b);
    const wSum = wA + wB;
    if (wSum === 0) return;

    const current = vec3.sub(b.position, a.position);
    const desired = vec3.scale(targetDir, targetLength);
    const error = vec3.scale(vec3.sub(desired, current), stiffness);

    a.position = vec3.sub(a.position, vec3.scale(error, wA / wSum));
    b.position = vec3.add(b.position, vec3.scale(error, wB / wSum));
  }

  protected direction(a: PhysicsBody, b: PhysicsBody): { dir: Vec3; dist: number } {
    const delta = vec3.sub(b.position, a.position);
    const dist = vec3.length(delta);
    const dir = dist < 1e-9 ? (this.record.restDir ?? [1, 0, 0]) : vec3.scale(delta, 1 / dist);
    return { dir, dist };
  }
}
