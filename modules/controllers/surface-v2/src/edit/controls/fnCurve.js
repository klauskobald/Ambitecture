/**
 * Normalized curve evaluation matching renderer FnCurve (simulator-2d / dmx-ts).
 * No clamping — values above 1 or below 0 pass through; clamp only at the hardware write point.
 */

const _functions = {
  linear: x => x,
  quadratic: x => Math.pow(x, 2),
  cubic: x => Math.pow(x, 3),
  sqrt: x => Math.sqrt(x),
  smoothstep: x => x * x * (3 - 2 * x),
  // Full strength inside the radius/range, instant cutoff at the edge.
  hard: x => (x > 0 ? 1 : 0)
}

/**
 * @param {string | undefined | null} name
 * @param {number} x
 * @returns {number}
 */
export function evaluate (name, x) {
  const fnName = typeof name === 'string' ? name : 'quadratic'
  const fn = _functions[fnName] || _functions.quadratic
  return fn(x)
}

/**
 * Inverse for monotonic curves on [0,1]. y is in [0,1].
 * When name is null/undefined, treats as linear (identity).
 * Unknown names use quadratic inverse to match {@link evaluate} fallback.
 *
 * @param {string | undefined | null} name
 * @param {number} y
 * @returns {number} t in [0,1]
 */
export function inverse (name, y) {
  const clampedY = Math.max(0, Math.min(1, y))
  if (name == null || name === 'linear') {
    return clampedY
  }
  const fnName = typeof name === 'string' ? name : 'quadratic'
  const effective = _functions[fnName] ? fnName : 'quadratic'
  switch (effective) {
    case 'linear':
      return clampedY
    case 'quadratic':
      return Math.sqrt(clampedY)
    case 'cubic':
      return Math.cbrt(clampedY)
    case 'sqrt':
      return clampedY * clampedY
    case 'smoothstep':
      return _inverseSmoothstep(clampedY)
    case 'hard':
      // Step function has no real inverse; return y itself for UI knob placement.
      return clampedY
    default:
      return Math.sqrt(clampedY)
  }
}

/**
 * @param {number} y
 * @returns {number}
 */
function _inverseSmoothstep (y) {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (_functions.smoothstep(mid) < y) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
