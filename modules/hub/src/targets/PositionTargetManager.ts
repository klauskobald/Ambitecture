import type { ProjectManager, FixtureProfile } from '../ProjectManager';
import type { RuntimeIntentStore } from '../RuntimeIntentStore';
import type { ConnectionRegistry } from '../ConnectionRegistry';
import { FnCurve } from '../FnCurve';
import { Logger } from '../Logger';

type Vec3 = [number, number, number];

/** A fixture that follows position targets — pilot scope: fixtures whose DMX map declares a `pan`. */
interface Follower {
  guid: string;
  name: string;
  zoneName: string;
  worldPos: Vec3;
  /** Slowest ease, seconds (per-instance `params.maxFollowTime`). */
  maxFollowTime: number;
  /** Eased unit aim direction (fixture→target); null until first acquisition. */
  resolvedDir: Vec3 | null;
  /** Diagnostic log throttle: last logged aim + time. */
  lastLogAim?: Vec3 | null;
  lastLogMs?: number;
}

/** An authored `target` lookAt magnet (hub-internal input). */
interface Magnet {
  name: string;
  position: Vec3;
  layer: number;
  alpha: number;
  radius: number;
  radiusFunction: string;
  /** Desired follow time in seconds (authored on the target; capped per-fixture by maxFollowTime). 0 = instant. */
  speed: number;
}

interface SerializedFixture {
  guid?: string;
  name?: string;
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
const RESYNC_TICKS = 15;   // ~300ms full re-emit so (re)connected renderers sync the current aim
const LOG_MIN_INTERVAL = 1000; // diagnostic log: at most once per second per fixture, only on change
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
  /** Force a full re-emit every N ticks so (re)connected renderers receive the current aim. */
  private ticksSinceResync = 0;

  constructor(
    private projectManager: ProjectManager,
    private runtimeIntentStore: RuntimeIntentStore,
    private registry: ConnectionRegistry,
  ) { }

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
          name: typeof fixture.name === 'string' ? fixture.name : fixture.guid,
          zoneName,
          worldPos: [bx + (loc[0] ?? 0), by + (loc[1] ?? 0), bz + (loc[2] ?? 0)],
          maxFollowTime: readMaxFollowTime(fixture.params),
          resolvedDir: prev?.resolvedDir ?? null,
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

    this.ticksSinceResync += 1;
    const resync = this.ticksSinceResync >= RESYNC_TICKS;
    if (resync) this.ticksSinceResync = 0;

    const magnets = this.activeMagnets();
    for (const follower of this.followers.values()) {
      const desired = this.resolveDesired(follower, magnets, nowMs);
      if (!desired) {
        if (resync) this.emitDir(follower); // re-sync a held aim to (re)connected renderers
        continue;
      }
      const eased = easeDir(follower.resolvedDir, desired.dir, desired.strength, desired.speed, follower.maxFollowTime, dt);
      const changed = !follower.resolvedDir || distance(follower.resolvedDir, eased) >= EPSILON;
      follower.resolvedDir = eased;
      if (changed || resync) this.emitDir(follower);
    }
  }

  private emitDir(follower: Follower): void {
    const dir = follower.resolvedDir;
    if (!dir) return;
    this.emit(follower, [
      follower.worldPos[0] + dir[0],
      follower.worldPos[1] + dir[1],
      follower.worldPos[2] + dir[2],
    ]);
  }

  private activeMagnets(): Magnet[] {
    const out: Magnet[] = [];
    for (const intent of this.projectManager.getActiveSceneIntents()) {
      if (intent.class !== 'target' || !intent.guid) continue;
      const eff = this.runtimeIntentStore.getEffectiveIntent(intent.guid) ?? intent;
      const pos = eff.position;
      if (!Array.isArray(pos)) continue;
      out.push({
        name: typeof eff.name === 'string' ? eff.name : intent.guid,
        position: [pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0],
        layer: numberOr(eff.layer, 0),
        alpha: numberOr(eff.params['alpha'], 1),
        radius: numberOr(eff.radius, 0),
        radiusFunction: typeof eff.radiusFunction === 'string' ? eff.radiusFunction : 'quadratic',
        speed: Math.max(0, numberOr(eff.params['speed'], 0.5)),
      });
    }
    return out;
  }

  /**
   * Strength-weighted aim **direction** (unit fixture→target vectors) within the highest in-range
   * layer — the angle bisector, independent of distance (a hard radius curve gives equal weights so
   * only direction matters). Null if no magnet reaches F, or they cancel exactly (opposite) → hold.
   */
  private resolveDesired(
    follower: Follower,
    magnets: Magnet[],
    nowMs = 0,
  ): { dir: Vec3; strength: number; speed: number } | null {
    let maxLayer = -Infinity;
    const contributions: { strength: number; dir: Vec3; speed: number; layer: number }[] = [];
    const dbg: string[] = [];
    for (const m of magnets) {
      const dist = distance(follower.worldPos, m.position);
      const norm = m.radius > 0 ? Math.max(0, 1 - dist / m.radius) : 0;
      const inRange = norm > 0;
      const strength = inRange ? m.alpha * FnCurve.evaluate(m.radiusFunction, norm) : 0;
      dbg.push(`${m.name} d=${dist.toFixed(2)}/r=${m.radius.toFixed(2)} L${m.layer} ${m.radiusFunction} str=${strength.toFixed(2)}`);
      if (!inRange || strength <= 0) continue;
      const dir = normalize(sub(m.position, follower.worldPos));
      if (!dir) continue; // target coincides with the fixture — no defined direction
      contributions.push({ strength, dir, speed: m.speed, layer: m.layer });
      if (m.layer > maxLayer) maxLayer = m.layer;
    }

    let total = 0;
    let speedAcc = 0;
    const acc: Vec3 = [0, 0, 0];
    for (const c of contributions) {
      if (c.layer !== maxLayer) continue; // layer override: only the highest in-range layer
      total += c.strength;
      acc[0] += c.dir[0] * c.strength;
      acc[1] += c.dir[1] * c.strength;
      acc[2] += c.dir[2] * c.strength;
      speedAcc += c.speed * c.strength;
    }
    const dir = total > 0 ? normalize(acc) : null;
    this.logResolved(follower, dir, maxLayer, dbg, nowMs);
    if (!dir) return null; // no magnet in range, or directions cancel exactly → hold last aim
    return { dir, strength: Math.min(1, total), speed: speedAcc / total };
  }

  /** Diagnostic: log only when the aim changes, throttled to once per second per fixture. */
  private logResolved(follower: Follower, dir: Vec3 | null, maxLayer: number, dbg: string[], nowMs: number): void {
    const prev = follower.lastLogAim ?? null;
    const changed = (dir != null) !== (prev != null) || (dir != null && prev != null && distance(dir, prev) > 0.02);
    if (!changed || nowMs - (follower.lastLogMs ?? 0) < LOG_MIN_INTERVAL) return;
    follower.lastLogAim = dir;
    follower.lastLogMs = nowMs;
    const aim = dir ? `x=${dir[0].toFixed(2)} z=${dir[2].toFixed(2)}` : 'none (no in-range magnet)';
    const layerStr = maxLayer === -Infinity ? '—' : String(maxLayer);
    // Logger.info(`[target] ${follower.name} layer=${layerStr} aim(${aim}) ← ${dbg.join(' | ') || 'no magnets'}`);
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

/**
 * Ease the unit aim direction toward `desired` (nlerp) over `min(speed, maxFollowTime) / strength`
 * seconds. First acquisition snaps. Returns a unit vector.
 */
function easeDir(current: Vec3 | null, desired: Vec3, strength: number, speed: number, maxFollowTime: number, dt: number): Vec3 {
  if (!current) return desired;
  const baseTime = Math.min(speed, maxFollowTime);
  const effectiveTime = baseTime / Math.max(strength, EPSILON);
  if (effectiveTime <= dt || effectiveTime <= 0) return desired;
  const factor = 1 - Math.exp(-dt / effectiveTime);
  const mixed: Vec3 = [
    current[0] + (desired[0] - current[0]) * factor,
    current[1] + (desired[1] - current[1]) * factor,
    current[2] + (desired[2] - current[2]) * factor,
  ];
  return normalize(mixed) ?? desired;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function normalize(v: Vec3): Vec3 | null {
  const m = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (m < 1e-9) return null;
  return [v[0] / m, v[1] / m, v[2] / m];
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function distance(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
