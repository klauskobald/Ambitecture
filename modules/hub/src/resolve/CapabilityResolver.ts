import { FnCurve } from '../FnCurve';
import type { BlendMode } from './resolveColor';

export type Vec3 = [number, number, number];

/** Resolved capability values for one fixture (e.g. `light.color.xyY`, `master.brightness`, `target`). */
export type Caps = Record<string, unknown>;

/** Normalized active intent the resolvers see (effective + class-normalized; `params.color` is xyY). */
export interface ResolveIntent {
  guid: string;
  intentClass: string;
  layer: number;
  /** Zone whose bbox contains the intent, or undefined for a global (position-less) intent. */
  zoneName?: string;
  position?: Vec3;
  radius?: number;
  radiusFunction?: string;
  blend: BlendMode;
  alpha: number;
  params: Record<string, unknown>;
}

/** Per-fixture context the orchestrator hands each resolver. */
export interface FixtureCtx {
  guid: string;
  name: string;
  zoneName: string;
  worldPos: Vec3;
  range: number;
  rangeFunction?: string;
  params: Record<string, unknown>;
  /** Serialized fixture profile (for resolvers that inspect channels, e.g. target needs `pan`). */
  profile?: Record<string, unknown>;
  /** Seconds since last tick (for stateful resolvers that ease over time). */
  dt: number;
}

/**
 * One per intent class (`light`, `master`, `target`, future `audio`/`motor`/…). The orchestrator
 * (`FixtureStateManager`) depends only on this interface — no per-class branches. A resolver may hold
 * its own per-fixture state (e.g. `target` eases) and use `ctx.dt`.
 */
export interface CapabilityResolver {
  /** Intent `class` this resolver consumes. */
  readonly intentClass: string;
  /** Contribute this class's resolved values into `caps` for one fixture. `intents` = this class's. */
  resolve(ctx: FixtureCtx, intents: ResolveIntent[], caps: Caps): void;
  /** Drop per-fixture state on project/scene reload. */
  onRefresh?(): void;
}

/** Intents that reach a fixture: global (no zone) or same zone — mirrors the renderer zone scoping. */
export function inFixtureZone(intent: ResolveIntent, zoneName: string): boolean {
  return intent.zoneName === undefined || intent.zoneName === zoneName;
}

export function distance(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Distance falloff identical to the renderer `LayerIntentEngine.computeSpatialFactor`: fixture `range`
 * curve × intent `radius` curve. Undefined curve name → `quadratic` (matches renderer FnCurve default).
 */
export function computeSpatialFactor(
  ctx: FixtureCtx,
  intentPos: Vec3 | undefined,
  intentRadius: number | undefined,
  intentRadiusFunction: string | undefined,
): number {
  if (!intentPos || ctx.range <= 0) return 1;
  const dist = distance(ctx.worldPos, intentPos);
  const fixtureNormalized = Math.max(0, 1 - dist / ctx.range);
  const fixtureFactor = FnCurve.evaluate(curveOrDefault(ctx.rangeFunction), fixtureNormalized);
  if (intentRadius === undefined || intentRadius <= 0) {
    return fixtureFactor;
  }
  const intentNormalized = Math.max(0, 1 - dist / intentRadius);
  const intentFactor = FnCurve.evaluate(curveOrDefault(intentRadiusFunction), intentNormalized);
  return fixtureFactor * intentFactor;
}

function curveOrDefault(name: string | undefined): string {
  return typeof name === 'string' && name.length > 0 ? name : 'quadratic';
}
