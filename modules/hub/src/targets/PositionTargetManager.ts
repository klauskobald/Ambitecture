import type { ProjectManager, FixtureProfile } from '../ProjectManager';
import type { RuntimeIntentStore } from '../RuntimeIntentStore';
import type { ConnectionRegistry } from '../ConnectionRegistry';
import { FnCurve } from '../FnCurve';

type Vec3 = [number, number, number];

/** A fixture that follows position targets — pilot scope: fixtures whose DMX map declares a `pan`. */
interface Follower {
  guid: string;
  zoneName: string;
  worldPos: Vec3;
  /** Slowest ease, seconds (per-instance `params.maxFollowTime`). */
  maxFollowTime: number;
  /** Last emitted aim point; null until first acquisition. */
  resolvedPos: Vec3 | null;
}

/** An authored `target` lookAt magnet (hub-internal input). */
interface Magnet {
  position: Vec3;
  layer: number;
  alpha: number;
  radius: number;
  radiusFunction: string;
  /** Slider 0..1 (quadratic → seconds against the fixture's maxFollowTime); 0 = instant. */
  speed: number;
}

interface SerializedFixture {
  guid?: string;
  fixtureProfile?: FixtureProfile;
  location?: Vec3;
  params?: Record<string, unknown>;
}

interface SerializedZone {
  name?: string;
  boundingBox?: number[];
  fixtures?: SerializedFixture[];
}

const TICK_MS = 20;
const DEFAULT_MAX_FOLLOW_TIME = 2;
const EPSILON = 1e-3;

/**
 * Hub-side, per-fixture resolution of `target` (lookAt magnet) intents. Each tick it blends the active
 * magnets per follower fixture (magnetism, layer override) and eases the result on the fixture's own
 * clock, emitting a resolved `target` event keyed by `fixtureGuid` to the renderers of the fixture's
 * zone. This is the pilot of the resolved-per-fixture architecture; renderers stay dumb and just aim.
 */
export class PositionTargetManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private followers = new Map<string, Follower>();
  private lastTickMs = 0;

  constructor(
    private projectManager: ProjectManager,
    private runtimeIntentStore: RuntimeIntentStore,
    private registry: ConnectionRegistry,
  ) {}

  start(): void {
    this.refresh();
    if (this.timer === null) {
      this.lastTickMs = Date.now();
      this.timer = setInterval(() => this.tick(), TICK_MS);
    }
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.followers.clear();
  }

  /** Rebuild the follower set from the current project; preserves resolved aim by fixture guid. */
  refresh(): void {
    const next = new Map<string, Follower>();
    const zones = this.projectManager.getSerializedRuntimeZones() as SerializedZone[];
    for (const zone of zones) {
      const bbox = zone.boundingBox;
      const zoneName = zone.name;
      if (!zoneName || !Array.isArray(bbox)) continue;
      const bx = bbox[0] ?? 0;
      const by = bbox[1] ?? 0;
      const bz = bbox[2] ?? 0;
      for (const fixture of zone.fixtures ?? []) {
        const loc = fixture.location;
        if (!fixture.guid || !Array.isArray(loc) || !consumesPositionTarget(fixture.fixtureProfile)) {
          continue;
        }
        const prev = this.followers.get(fixture.guid);
        next.set(fixture.guid, {
          guid: fixture.guid,
          zoneName,
          worldPos: [bx + (loc[0] ?? 0), by + (loc[1] ?? 0), bz + (loc[2] ?? 0)],
          maxFollowTime: readMaxFollowTime(fixture.params),
          resolvedPos: prev?.resolvedPos ?? null,
        });
      }
    }
    this.followers = next;
  }

  private tick(): void {
    const nowMs = Date.now();
    const dt = Math.max(0, (nowMs - this.lastTickMs) / 1000);
    this.lastTickMs = nowMs;
    if (this.followers.size === 0) return;

    const magnets = this.activeMagnets();
    for (const follower of this.followers.values()) {
      const desired = this.resolveDesired(follower, magnets);
      if (!desired) continue; // no magnet in range → hold last aim
      const eased = ease(follower.resolvedPos, desired.position, desired.strength, desired.speed, follower.maxFollowTime, dt);
      if (follower.resolvedPos && distance(follower.resolvedPos, eased) < EPSILON) continue;
      follower.resolvedPos = eased;
      this.emit(follower, eased);
    }
  }

  private activeMagnets(): Magnet[] {
    const out: Magnet[] = [];
    for (const intent of this.projectManager.getActiveSceneIntents()) {
      if (intent.class !== 'target' || !intent.guid) continue;
      const eff = this.runtimeIntentStore.getEffectiveIntent(intent.guid) ?? intent;
      const pos = eff.position;
      if (!Array.isArray(pos)) continue;
      out.push({
        position: [pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0],
        layer: numberOr(eff.layer, 0),
        alpha: numberOr(eff.params['alpha'], 1),
        radius: numberOr(eff.radius, 0),
        radiusFunction: typeof eff.radiusFunction === 'string' ? eff.radiusFunction : 'quadratic',
        speed: clamp01(numberOr(eff.params['speed'], 0.5)),
      });
    }
    return out;
  }

  /** Strength-weighted aim point within the highest in-range layer; null if no magnet reaches F. */
  private resolveDesired(
    follower: Follower,
    magnets: Magnet[],
  ): { position: Vec3; strength: number; speed: number } | null {
    let maxLayer = -Infinity;
    const contributions: { strength: number; m: Magnet }[] = [];
    for (const m of magnets) {
      if (m.radius <= 0) continue;
      const norm = Math.max(0, 1 - distance(follower.worldPos, m.position) / m.radius);
      if (norm <= 0) continue;
      const strength = m.alpha * FnCurve.evaluate(m.radiusFunction, norm);
      if (strength <= 0) continue;
      contributions.push({ strength, m });
      if (m.layer > maxLayer) maxLayer = m.layer;
    }

    let total = 0;
    let speedAcc = 0;
    const acc: Vec3 = [0, 0, 0];
    for (const c of contributions) {
      if (c.m.layer !== maxLayer) continue; // layer override: only the highest in-range layer
      total += c.strength;
      acc[0] += c.m.position[0] * c.strength;
      acc[1] += c.m.position[1] * c.strength;
      acc[2] += c.m.position[2] * c.strength;
      speedAcc += c.m.speed * c.strength;
    }
    if (total <= 0) return null;
    return {
      position: [acc[0] / total, acc[1] / total, acc[2] / total],
      strength: Math.min(1, total),
      speed: speedAcc / total,
    };
  }

  private emit(follower: Follower, position: Vec3): void {
    const rendererGuids = this.projectManager.getZoneToRendererPayload()[follower.zoneName] ?? [];
    if (rendererGuids.length === 0) return;
    const rendererGuidSet = new Set(rendererGuids);
    const msg = JSON.stringify({
      message: {
        type: 'events',
        payload: [{ guid: `target:${follower.guid}`, class: 'target', fixtureGuid: follower.guid, position }],
      },
    });
    for (const ws of this.registry.getByRole('renderer')) {
      const info = this.registry.get(ws);
      if (!info || !rendererGuidSet.has(info.guid) || ws.readyState !== ws.OPEN) continue;
      ws.send(msg);
    }
  }
}

/** Pilot scope: a fixture consumes a position target if its DMX map declares a `pan` function. */
function consumesPositionTarget(profile: FixtureProfile | undefined): boolean {
  const dmx = profile?.params?.['dmx'];
  if (!dmx || typeof dmx !== 'object') return false;
  for (const defs of Object.values(dmx as Record<string, unknown>)) {
    if (!Array.isArray(defs)) continue;
    for (const def of defs) {
      if (def && typeof def === 'object' && (def as Record<string, unknown>)['function'] === 'pan') {
        return true;
      }
    }
  }
  return false;
}

function readMaxFollowTime(params: Record<string, unknown> | undefined): number {
  const v = params?.['maxFollowTime'];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_MAX_FOLLOW_TIME;
}

/** First acquisition snaps; otherwise exponential approach over `quad(speed) × maxFollowTime / strength`. */
function ease(current: Vec3 | null, desired: Vec3, strength: number, speed: number, maxFollowTime: number, dt: number): Vec3 {
  if (!current) return desired;
  const baseTime = speed * speed * maxFollowTime;
  const effectiveTime = baseTime / Math.max(strength, EPSILON);
  if (effectiveTime <= dt || effectiveTime <= 0) return desired;
  const factor = 1 - Math.exp(-dt / effectiveTime);
  return [
    current[0] + (desired[0] - current[0]) * factor,
    current[1] + (desired[1] - current[1]) * factor,
    current[2] + (desired[2] - current[2]) * factor,
  ];
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function distance(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
