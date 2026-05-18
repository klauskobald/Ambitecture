/** @type {Set<() => void>} */
const listeners = new Set()

/** Notify Perform pulse sync UI that the hub received `pulse:sync`. */
export function notifyPulseSyncReceived () {
  for (const fn of listeners) {
    fn()
  }
}

/**
 * @param {() => void} fn
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
