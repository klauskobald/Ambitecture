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

const VISIBILITY_KEY = 'ambitecture.surface-v2.helpVisible'

/**
 * @returns {boolean}
 */
export function loadHelpVisible () {
  try {
    const raw = localStorage.getItem(VISIBILITY_KEY)
    if (raw === null) return true
    return raw === 'true'
  } catch {
    return true
  }
}

/**
 * @param {boolean} visible
 */
export function saveHelpVisible (visible) {
  try {
    localStorage.setItem(VISIBILITY_KEY, visible ? 'true' : 'false')
  } catch {
    /* ignore */
  }
}

const ICON_POS_KEY = 'ambitecture.surface-v2.helpIconPos'

/**
 * Saved standalone toggle-icon anchor point (its top-right corner).
 * @returns {{ x: number, y: number } | null}
 */
export function loadIconAnchor () {
  try {
    const raw = localStorage.getItem(ICON_POS_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const o = /** @type {Record<string, unknown>} */ (parsed)
    if (typeof o.x !== 'number' || !Number.isFinite(o.x)) return null
    if (typeof o.y !== 'number' || !Number.isFinite(o.y)) return null
    return { x: o.x, y: o.y }
  } catch {
    return null
  }
}

/**
 * @param {{ x: number, y: number }} anchor top-right corner of the icon
 */
export function saveIconAnchor (anchor) {
  try {
    localStorage.setItem(ICON_POS_KEY, JSON.stringify(anchor))
  } catch {
    /* ignore */
  }
}
