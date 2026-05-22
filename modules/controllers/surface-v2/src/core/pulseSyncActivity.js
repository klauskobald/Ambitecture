/** @type {Set<(bpm: number | undefined) => void>} */
const listeners = new Set()

/**
 * @param {unknown} payload hub `hub:status` payload
 * @returns {number | undefined}
 */
export function readPulseSyncRxBpm (payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined
  }
  const data = /** @type {{ data?: { bpm?: unknown } }} */ (payload).data
  const bpm = data?.bpm
  return typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0 ? bpm : undefined
}

/**
 * Notify Perform pulse sync UI that the hub received `pulse:sync`.
 * @param {number | undefined} bpm detected tempo from inbound sync (when present)
 */
export function notifyPulseSyncReceived (bpm) {
  for (const fn of listeners) {
    fn(bpm)
  }
}

/**
 * @param {(bpm: number | undefined) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribePulseSyncReceived (fn) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * @param {unknown} payload hub `hub:status` payload
 * @returns {boolean}
 */
export function isPulseSyncRxHubStatus (payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false
  }
  return /** @type {{ kind?: string }} */ (payload).kind === 'pulseSyncRx'
}
