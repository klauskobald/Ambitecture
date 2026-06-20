/**
 * @typedef {object} HelpPanelGeometry
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */

const STORAGE_KEY = 'ambitecture.surface-v2.helpPanel'

/**
 * Single shared geometry reused by every floating help key.
 * @returns {HelpPanelGeometry | null}
 */
export function loadHelpPanelGeometry () {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const o = /** @type {Record<string, unknown>} */ (parsed)
    const nums = ['x', 'y', 'w', 'h'].map(k => o[k])
    if (nums.some(n => typeof n !== 'number' || !Number.isFinite(n))) return null
    const [x, y, w, h] = /** @type {number[]} */ (nums)
    return { x, y, w, h }
  } catch {
    return null
  }
}

/**
 * @param {HelpPanelGeometry} geom
 */
export function saveHelpPanelGeometry (geom) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(geom))
  } catch {
    /* ignore quota / private mode */
  }
}
