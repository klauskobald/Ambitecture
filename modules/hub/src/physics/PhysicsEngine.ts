import { PhysicsBody } from './PhysicsBody';
import { vec3, type Vec3 } from './vec3';
import { ConnectorBase, type ConnectorRecord } from './connectors/ConnectorBase';
// Side-effect imports register the connector kinds with ConnectorBase.
import './connectors/RodConnector';
import './connectors/SpringConnector';
import './connectors/RopeConnector';
import './connectors/DragConnector';

export interface PhysicsConfig {
  /** Solver rate while awake (Hz). Speeds are frame-rate independent regardless of this value. */
  fps: number;
  /** Sleep when every free body's speed drops below this (m/s). */
  sleepVelocity: number;
  /** Constraint relaxation passes per sub-step. */
  iterations: number;
  /** How often to check isSettled (ms). Decoupled from the tick rate. */
  watchIntervalMs: number;
}

/** Consumer hook: the engine offers a candidate state, the consumer returns the committed one (e.g. wall-clamped). */
export type CommitFn = (id: string, position: Vec3, velocity: Vec3) => { position: Vec3; velocity: Vec3 };

const MAX_FRAME_MS = 250;
const MAX_STEPS_PER_TICK = 8;

/**
 * Generic point-mass solver with connector constraints. Knows nothing about intents, zones, or
 * transport — it integrates bodies, relaxes constraints, and hands each committed position back through
 * {@link onCommit}. Time-constant: a fixed sub-step accumulator advances the same simulated time per
 * wall-second whatever the actual tick rate, and it sleeps (stops ticking) once motion settles.
 */
export class PhysicsEngine {
  private readonly bodies = new Map<string, PhysicsBody>();
  private connectors: ConnectorBase[] = [];
  private commitFn: CommitFn = (_id, position, velocity) => ({ position, velocity });

  private timer: ReturnType<typeof setTimeout> | undefined;
  private watchTimer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private lastWallMs = 0;
  private accumulatorMs = 0;

  constructor(private readonly config: PhysicsConfig) { }

  setBody(body: PhysicsBody): void {
    this.bodies.set(body.id, body);
  }

  getBody(id: string): PhysicsBody | undefined {
    return this.bodies.get(id);
  }

  removeBody(id: string): void {
    this.bodies.delete(id);
  }

  clear(): void {
    this.bodies.clear();
    this.connectors = [];
  }

  setConnectors(records: ConnectorRecord[]): void {
    this.connectors = records
      .map(record => ConnectorBase.create(record))
      .filter((c): c is ConnectorBase => c !== null);
  }

  /** Add a single connector (e.g. a transient drag spring) without disturbing the others. */
  addConnector(record: ConnectorRecord): void {
    const connector = ConnectorBase.create(record);
    if (connector) this.connectors.push(connector);
  }

  removeConnector(guid: string): void {
    this.connectors = this.connectors.filter(c => c.guid !== guid);
  }

  onCommit(fn: CommitFn): void {
    this.commitFn = fn;
  }

  get bodyCount(): number { return this.bodies.size; }

  /** Start (or keep) the solver running. Call whenever an external move perturbs the network. */
  wake(): void {
    if (this.running) return;
    this.running = true;
    this.lastWallMs = Date.now();
    this.accumulatorMs = 0;
    this.scheduleNextTick();
    this.scheduleWatch();
  }

  stop(): void {
    if (!this.running && this.timer === undefined) return;
    this.running = false;
    if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined; }
    if (this.watchTimer !== undefined) { clearTimeout(this.watchTimer); this.watchTimer = undefined; }
  }

  private scheduleNextTick(): void {
    if (!this.running) return;
    const periodMs = 1000 / this.config.fps;
    this.timer = setTimeout(() => this.onTick(), periodMs);
  }

  private scheduleWatch(): void {
    if (!this.running) return;
    this.watchTimer = setTimeout(() => this.onWatch(), this.config.watchIntervalMs);
  }

  private onTick(): void {
    this.timer = undefined;
    if (!this.running) return;
    const now = Date.now();
    this.advance(now - this.lastWallMs);
    this.lastWallMs = now;
    this.scheduleNextTick();
  }

  private onWatch(): void {
    this.watchTimer = undefined;
    if (!this.running) return;
    if (this.isSettled()) { this.running = false; this.stop(); return; }
    this.scheduleWatch();
  }

  /**
   * Advance the simulation by `frameMs` of wall time using fixed sub-steps, so the result is
   * independent of how often this is called. Exposed for deterministic testing; the live loop calls it
   * from {@link onTick}. The watch timer decides when to sleep — this just advances time.
   */
  advance(frameMs: number): void {
    this.accumulatorMs += Math.min(MAX_FRAME_MS, Math.max(0, frameMs));
    const stepMs = 1000 / this.config.fps;
    const dt = stepMs / 1000;
    let steps = 0;
    while (this.accumulatorMs >= stepMs && steps < MAX_STEPS_PER_TICK) {
      this.subStep(dt);
      this.accumulatorMs -= stepMs;
      steps += 1;
    }
  }

  /**
   * One semi-implicit-Euler + PBD step at a fixed `dt`:
   *  1. **Damp** — `velocity *= (1 - drag)^dt` (drag 0 keeps full speed forever).
   *  2. **Forces** — soft connectors (springs) add `F·dt` impulses to velocity (mutual, mass-weighted).
   *  3. **Predict** — `position += velocity * dt` (pinned bodies are externally driven; they only record `prevPosition`).
   *  4. **Project** — rigid connectors (rod, rope) relax their distance constraint by moving positions.
   *  5. **Re-derive velocity** — `velocity = (position - prevPosition) / dt`, so the rigid correction
   *     also acts as an impulse and momentum carries between connected bodies.
   * Fixed `dt` (driven by the sub-step accumulator) makes the result independent of the wall frame rate.
   */
  private subStep(dt: number): void {
    for (const body of this.bodies.values()) {
      if (body.pinned) continue;
      const dragFactor = Math.pow(1 - this.clampUnit(body.drag), dt);
      body.velocity = vec3.scale(body.velocity, dragFactor);
    }

    for (const connector of this.connectors) {
      const a = this.bodies.get(connector.aId);
      const b = this.bodies.get(connector.bId);
      if (a && b) connector.applyForce(a, b, dt);
    }

    for (const body of this.bodies.values()) {
      body.prevPosition = vec3.clone(body.position);
      if (body.pinned) continue;
      body.position = vec3.add(body.position, vec3.scale(body.velocity, dt));
    }

    for (let i = 0; i < this.config.iterations; i += 1) {
      for (const connector of this.connectors) {
        const a = this.bodies.get(connector.aId);
        const b = this.bodies.get(connector.bId);
        if (a && b) connector.project(a, b);
      }
    }

    for (const body of this.bodies.values()) {
      if (body.pinned) continue;
      body.velocity = vec3.scale(vec3.sub(body.position, body.prevPosition), 1 / dt);
      const committed = this.commitFn(body.id, body.position, body.velocity);
      body.position = committed.position;
      body.velocity = committed.velocity;
    }
  }

  private clampUnit(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  private isSettled(): boolean {
    for (const body of this.bodies.values()) {
      if (body.pinned) return false;
      if (vec3.length(body.velocity) >= this.config.sleepVelocity) return false;
    }
    return true;
  }
}
