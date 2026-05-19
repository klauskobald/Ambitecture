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

const PULSE_SPEED_MIN = 0.25
const PULSE_SPEED_MAX = 4

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
 * @param {number} speed
 * @returns {string}
 */
export function formatPulseSpeedLabel (speed) {
  const s = clampPulseSetupSpeed(speed)
  if (s === 0.25) {
    return '1/4x'
  }
  if (s === 0.5) {
    return '1/2x'
  }
  if (s === 1) {
    return '1x'
  }
  if (Number.isInteger(s) && s >= 2 && s <= 4) {
    return `${s}x`
  }
  const t = Math.round(s * 1000) / 1000
  return `${t}x`
}
