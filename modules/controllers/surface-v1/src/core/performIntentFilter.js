/**
 * Shared perform-mode intent filter (Animate list, plugin iframes, subnav funnel chip).
 * Single source of truth for which intent GUID filters operator UIs.
 */

/** @type {string | null} */
let intentFilterGuid = null

/** @type {Set<(guid: string | null) => void>} */
const listeners = new Set()

/**
 * @returns {string | null}
 */
export function getPerformIntentFilter () {
  return intentFilterGuid
}

/**
 * @param {string | null | undefined} guid
 */
export function setPerformIntentFilter (guid) {
  const next =
    guid && typeof guid === 'string' && guid.trim() !== '' ? guid.trim() : null
  if (next === intentFilterGuid) return
  intentFilterGuid = next
  for (const cb of listeners) cb(intentFilterGuid)
}

/**
 * @param {(guid: string | null) => void} cb
 * @returns {() => void}
 */
export function subscribePerformIntentFilter (cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/**
 * Tapping the same intent twice clears the filter.
 * @param {string | null | undefined} guid
 */
export function togglePerformIntentFilter (guid) {
  const g =
    guid && typeof guid === 'string' && guid.trim() !== '' ? guid.trim() : null
  if (!g) {
    setPerformIntentFilter(null)
    return
  }
  if (intentFilterGuid === g) setPerformIntentFilter(null)
  else setPerformIntentFilter(g)
}
