import { FnCurve } from '../../FnCurve';
import {
  type CapabilityResolver,
  type FixtureCtx,
  type ResolveIntent,
  type Caps,
  type Vec3,
  distance,
} from '../CapabilityResolver';

const DEFAULT_MAX_FOLLOW_TIME = 2;
const EPSILON = 1e-3;

/**
 * `target` (lookAt magnet) resolver — for fixtures that consume position targets (DMX `pan` channel).
 * Stateful: eases a per-fixture unit aim direction toward the strength-weighted bisector of in-range
 * magnets (magnetism + layer override) on the fixture's own `maxFollowTime`/`speed` clock, and
 * contributes `caps.target = worldPos + easedDir` (a point) so the renderer's `atan2`+`panUnwrap` is
 * unchanged. Folds the former `PositionTargetManager` (math preserved verbatim).
 */
export class TargetResolver implements CapabilityResolver {
  readonly intentClass = 'target';
  /** Per-fixture eased unit aim direction; null until first acquisition. */
  private resolvedDir = new Map<string, Vec3>();

  onRefresh(): void {
    this.resolvedDir.clear();
  }

  resolve(ctx: FixtureCtx, intents: ResolveIntent[], caps: Caps): void {
    if (!consumesPositionTarget(ctx.profile)) return;
    const desired = resolveDesiredDir(ctx.worldPos, intents);
    const current = this.resolvedDir.get(ctx.guid) ?? null;
    if (!desired) {
      // No magnet in range (or they cancel) → hold last aim. Re-emit the held point if we have one.
      if (current) caps['target'] = aimPoint(ctx.worldPos, current);
      return;
    }
    const maxFollowTime = readMaxFollowTime(ctx.params);
    const eased = easeDir(current, desired.dir, desired.strength, desired.speed, maxFollowTime, ctx.dt);
    this.resolvedDir.set(ctx.guid, eased);
    caps['target'] = aimPoint(ctx.worldPos, eased);
  }
}

function aimPoint(worldPos: Vec3, dir: Vec3): Vec3 {
  return [worldPos[0] + dir[0], worldPos[1] + dir[1], worldPos[2] + dir[2]];
}

/** Strength-weighted aim direction within the highest in-range layer; null if none / they cancel. */
function resolveDesiredDir(
  worldPos: Vec3,
  magnets: ResolveIntent[],
): { dir: Vec3; strength: number; speed: number } | null {
  let maxLayer = -Infinity;
  const contributions: { strength: number; dir: Vec3; speed: number; layer: number }[] = [];
  for (const m of magnets) {
    if (!m.position) continue;
    const radius = m.radius ?? 0;
    if (radius <= 0) continue;
    const norm = Math.max(0, 1 - distance(worldPos, m.position) / radius);
    if (norm <= 0) continue;
    const radiusFunction = typeof m.radiusFunction === 'string' ? m.radiusFunction : 'quadratic';
    const strength = m.alpha * FnCurve.evaluate(radiusFunction, norm);
    if (strength <= 0) continue;
    const toMagnet = normalize(sub(m.position, worldPos));
    if (!toMagnet) continue;
    const isRepel = m.params['mode'] === 'Repel';
    const dir: Vec3 = isRepel ? [-toMagnet[0], -toMagnet[1], -toMagnet[2]] : toMagnet;
    const speed = Math.max(0, numberOr(m.params['speed'], 0.5));
    contributions.push({ strength, dir, speed, layer: m.layer });
    if (m.layer > maxLayer) maxLayer = m.layer;
  }

  let total = 0;
  let speedAcc = 0;
  const acc: Vec3 = [0, 0, 0];
  for (const c of contributions) {
    if (c.layer !== maxLayer) continue;
    total += c.strength;
    acc[0] += c.dir[0] * c.strength;
    acc[1] += c.dir[1] * c.strength;
    acc[2] += c.dir[2] * c.strength;
    speedAcc += c.speed * c.strength;
  }
  const dir = total > 0 ? normalize(acc) : null;
  if (!dir) return null;
  return { dir, strength: Math.min(1, total), speed: speedAcc / total };
}

/** Ease the unit aim direction toward `desired` (nlerp) over `min(speed, maxFollowTime)/strength` s. */
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

/** Pilot scope: a fixture consumes a position target if its DMX map declares a `pan` function. */
function consumesPositionTarget(profile: Record<string, unknown> | undefined): boolean {
  const params = profile?.['params'];
  const dmx = params && typeof params === 'object' ? (params as Record<string, unknown>)['dmx'] : undefined;
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

function readMaxFollowTime(params: Record<string, unknown>): number {
  const v = params['maxFollowTime'];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_MAX_FOLLOW_TIME;
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function normalize(v: Vec3): Vec3 | null {
  const m = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (m < 1e-9) return null;
  return [v[0] / m, v[1] / m, v[2] / m];
}
