/**
 * Latched on/off for `toggle` perform inputs — browser memory only (not project graph).
 */

/** @type {Map<string, boolean>} */
const onByInputGuid = new Map()

/**
 * @param {string} inputGuid
 * @returns {boolean}
 */
export function getPerformToggleOn (inputGuid) {
  if (!inputGuid) return false
  return onByInputGuid.get(inputGuid) === true
}

/**
 * Flip latched state; returns hub trigger branch `on` | `off`.
 * @param {string} inputGuid
 * @returns {'on' | 'off'}
 */
export function togglePerformToggleAndGetValue (inputGuid) {
  const next = !(onByInputGuid.get(inputGuid) === true)
  onByInputGuid.set(inputGuid, next)
  return next ? 'on' : 'off'
}

/**
 * @param {string} inputGuid
 */
export function clearPerformToggleState (inputGuid) {
  if (!inputGuid) return
  onByInputGuid.delete(inputGuid)
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeAttr (s) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(s)
  }
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Sync `.perform-input--toggle-on` + `aria-pressed` for strip buttons (and modal rows share data-input-guid).
 * @param {string} inputGuid
 */
export function syncPerformToggleChrome (inputGuid) {
  if (!inputGuid) return
  const on = getPerformToggleOn(inputGuid)
  const g = escapeAttr(inputGuid)
  const nodes = document.querySelectorAll(
    `button.perform-input[data-input-guid="${g}"][data-behavior="toggle"]`
  )
  for (const el of nodes) {
    if (!(el instanceof HTMLButtonElement)) continue
    el.classList.toggle('perform-input--toggle-on', on)
    el.setAttribute('aria-pressed', on ? 'true' : 'false')
  }
}
