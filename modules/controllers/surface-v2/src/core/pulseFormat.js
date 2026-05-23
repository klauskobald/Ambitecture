/**
 * @param {number} bpm
 * @returns {string}
 */
export function formatPulseBpmDisplay (bpm) {
  if (typeof bpm !== 'number' || !Number.isFinite(bpm)) {
    return '120.0'
  }
  return bpm.toFixed(1)
}

/**
 * @param {number} bpm
 * @returns {number}
 */
export function clampPulseBpm (bpm) {
  if (typeof bpm !== 'number' || !Number.isFinite(bpm)) {
    return 120
  }
  return Math.min(300, Math.max(20, bpm))
}

export const PULSE_SPEED_MIN = 1 / 128
export const PULSE_SPEED_MAX = 4

/**
 * @param {number} speed
 * @returns {number}
 */
export function clampPulseSetupSpeed (speed) {
  if (typeof speed !== 'number' || !Number.isFinite(speed)) {
    return 1
  }
  return Math.min(PULSE_SPEED_MAX, Math.max(PULSE_SPEED_MIN, speed))
}

/**
 * Speed is stepped in half/double → values are (approximately) powers of two.
 * @param {number} s clamped speed
 * @returns {number | null} exponent n where s ≈ 2^n
 */
function pulseSpeedPowerOfTwoExponent (s) {
  if (s <= 0 || !Number.isFinite(s)) return null
  const n = Math.round(Math.log2(s))
  const candidate = 2 ** n
  const relErr = Math.abs(s - candidate) / Math.max(s, candidate)
  return relErr < 1e-5 ? n : null
}

/**
 * @param {number} speed
 * @returns {string}
 */
export function formatPulseSpeedLabel (speed) {
  const s = clampPulseSetupSpeed(speed)
  const n = pulseSpeedPowerOfTwoExponent(s)
  if (n !== null) {
    if (n === 0) return '1x'
    if (n < 0) return `1/${2 ** -n}x`
    return `${2 ** n}x`
  }
  const t = Math.round(s * 1000) / 1000
  return `${t}x`
}
