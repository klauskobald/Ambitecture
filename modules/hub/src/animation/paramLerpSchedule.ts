import { FnCurve } from '../FnCurve';

import type { DotPathRecord } from '../dotPath';

/** Quantization floor — inputs clamp to this minimum for ceil(|Δ| / q) step-count math. */
export const MIN_LERP_QUANTIZATION = 0.001;

/** Hard cap per segment to avoid pathological schedules (quantization + tiny gaps). */
export const MAX_LERP_SUBSTEPS_PER_SEGMENT = 500;

/**
 * `effectiveQuantization = max(parsedQuantization, MIN_LERP_QUANTIZATION)` so inputs below
 * 0.001 still use 0.001 for step-count math.
 */
export function effectiveLerpQuantization(configQuantization: unknown): number {
  if (
    typeof configQuantization === 'number' &&
    Number.isFinite(configQuantization) &&
    configQuantization > 0
  ) {
    return Math.max(configQuantization, MIN_LERP_QUANTIZATION);
  }
  return MIN_LERP_QUANTIZATION;
}

function mergePath(prefix: string, segment: string): string {
  return prefix === '' ? segment : `${prefix}.${segment}`;
}

/** Dot-path keys intersect `applyDotPathPatch` / YAML keyframe args (e.g. `params.alpha`, `position.2`). */
function collectNumericLeafDiffs(a: unknown, b: unknown, pathPrefix: string, out: Map<string, { from: number; to: number }>): void {
  const bothNums =
    typeof a === 'number' &&
    typeof b === 'number' &&
    Number.isFinite(a) &&
    Number.isFinite(b);

  if (bothNums) {
    out.set(pathPrefix, { from: a, to: b });
    return;
  }

  const aObj = typeof a === 'object' && a !== null && !Array.isArray(a);
  const bObj = typeof b === 'object' && b !== null && !Array.isArray(b);
  if (aObj && bObj) {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
    for (const k of keys) {
      if (!Object.prototype.hasOwnProperty.call(ra, k) || !Object.prototype.hasOwnProperty.call(rb, k)) {
        continue;
      }
      collectNumericLeafDiffs(ra[k], rb[k], mergePath(pathPrefix, k), out);
    }
    return;
  }

  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr && bArr && a.length === b.length) {
    for (let i = 0; i < a.length; i++) {
      collectNumericLeafDiffs(a[i], b[i], mergePath(pathPrefix, String(i)), out);
    }
  }
}

/**
 * Recursive walk: paths where both endpoints are finite numbers (nested objects only; tuples as numeric index chains).
 */
export function diffNumericLeaves(fromRoot: DotPathRecord, toRoot: DotPathRecord): Map<string, { from: number; to: number }> {
  const out = new Map<string, { from: number; to: number }>();
  collectNumericLeafDiffs(fromRoot, toRoot, '', out);
  return out;
}

export interface PlannedLerpKeyframesSegment {
  /**
   * Substep cardinality for this segment; `n <= 1` means no interpolated fires (anchors only).
   * May cap to {@link MAX_LERP_SUBSTEPS_PER_SEGMENT} or tighter via {@link capNFromMinSpacing}.
   */
  n: number;

  /** Eased patches for intermediate fires only (`k = 0 … n-2`); last sample uses exact keyframe at segment end instead. */
  intermediateDotPatches: Record<string, number>[];
}

/**
 * Clamp segment step count `n` so uniform spacing along [segmentStart … segmentEnd]
 * satisfies `wallSpan/(n-1) >= minGapWallMs` (intermediate fires only; same grid as planner).
 *
 * (`n`: eased samples cardinality; intermediates fire at fractions `k/(n-1)` for `k = 0 … n-2`).
 */
export function capNFromMinSpacing(
  n: number,
  wallSpanMs: number,
  minGapWallMs: number,
): number {
  if (!(minGapWallMs > 0 && Number.isFinite(minGapWallMs))) {
    return n;
  }
  if (!(wallSpanMs > 0 && Number.isFinite(wallSpanMs))) {
    return Math.min(n, 1);
  }
  /** `span/(nCap-1) >= gap` ⇒ `nCap - 1 <= span/gap` ⇒ `nCap <= floor(span/gap)+1`. */
  const nCapGap = Math.max(1, Math.floor(wallSpanMs / minGapWallMs) + 1);
  return Math.min(n, nCapGap);
}

export interface PlanIntermediateLerpOptions {
  /**
   * When both set with {@link minGapWallMs}, `n` is capped so consecutive planned lerp
   * times are ≥ `minGapWallMs` apart (wall-ms; pass `nominalMinMs × timescale` from animator).
   */
  segmentWallSpanMs?: number;
  minGapWallMs?: number;
  onQuantizationCappedOriginalN?: (originalN: number) => void;
}

/** `n = max(1, max over changing leaves of ceil(|Δ| / quantizationEff))`; may cap and invoke callbacks. */
export function planIntermediateLerpPatches(
  fromIntent: DotPathRecord,
  toIntent: DotPathRecord,
  quantizationEffective: number,
  curveName: unknown,
  opts?: PlanIntermediateLerpOptions,
): PlannedLerpKeyframesSegment {
  const leaves = diffNumericLeaves(fromIntent, toIntent);
  let nRaw = 1;
  for (const { from, to } of leaves.values()) {
    const delta = Math.abs(to - from);
    if (delta === 0) continue;
    const stepsLeaf = Math.ceil(delta / quantizationEffective);
    nRaw = Math.max(nRaw, stepsLeaf);
  }

  let n = Math.max(1, nRaw);
  if (n > MAX_LERP_SUBSTEPS_PER_SEGMENT) {
    opts?.onQuantizationCappedOriginalN?.(n);
    n = MAX_LERP_SUBSTEPS_PER_SEGMENT;
  }

  const gapSpan = opts?.segmentWallSpanMs;
  const minGapWall = opts?.minGapWallMs;
  if (gapSpan !== undefined && minGapWall !== undefined) {
    n = capNFromMinSpacing(n, gapSpan, minGapWall);
  }

  const intermediateDotPatches: Record<string, number>[] = [];
  if (n <= 1 || leaves.size === 0) {
    return { n, intermediateDotPatches };
  }

  for (let k = 0; k <= n - 2; k++) {
    const tLinear = k / (n - 1);
    const u = FnCurve.evaluate(curveName, tLinear);
    const patch: Record<string, number> = {};
    for (const [dotPath, ends] of leaves) {
      patch[dotPath] = ends.from + (ends.to - ends.from) * u;
    }
    intermediateDotPatches.push(patch);
  }

  return { n, intermediateDotPatches };
}
