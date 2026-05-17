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
