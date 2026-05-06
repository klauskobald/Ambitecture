/**
 * Tracks which animation GUIDs the hub reports as actively playing via `hub:status`
 * (kind === 'animation'). Used by Perform → Animate play/stop UI.
 */

/** @type {Set<string>} */
const playingAnimationGuids = new Set()

/** @type {Map<string, string>} */
const statusMessages = new Map()

/** @type {Set<() => void>} */
const listeners = new Set()

/** @param {() => void} fn @returns {() => void} */
export function subscribeAnimationPlayState (fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notify () {
  for (const fn of listeners) fn()
}

/** Drop local playback hints (e.g. after `graph:init` / reconnect). */
export function resetAnimationPlayState () {
  if (playingAnimationGuids.size === 0 && statusMessages.size === 0) return
  playingAnimationGuids.clear()
  statusMessages.clear()
  notify()
}

/**
 * @param {unknown} payload hub `hub:status` payload (`kind`, `animationGuid`, `status`, …).
 */
export function applyHubAnimationStatus (payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return
  const p = /** @type {Record<string, unknown>} */ (payload)
  if (p.kind !== 'animation') return
  const guid = typeof p.animationGuid === 'string' ? p.animationGuid : ''
  if (!guid) return
  const status = typeof p.status === 'string' ? p.status : ''
  if (status === 'started') {
    playingAnimationGuids.add(guid)
  } else if (status === 'stopped' || status === 'paused') {
    playingAnimationGuids.delete(guid)
  }
  const msg = p.message
  if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
    const text = typeof (/** @type {Record<string,unknown>} */ (msg)).text === 'string'
      ? /** @type {Record<string,unknown>} */ (msg).text
      : ''
    if (text) statusMessages.set(guid, text)
  }
  notify()
}

/** @param {string} animationGuid @returns {string} */
export function getAnimationStatusMessage (animationGuid) {
  return statusMessages.get(animationGuid) ?? ''
}

/** @param {string} animationGuid */
export function isAnimationPlaying (animationGuid) {
  return playingAnimationGuids.has(animationGuid)
}
