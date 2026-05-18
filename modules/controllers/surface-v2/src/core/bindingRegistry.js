import { sendBindingSubscribe } from './outboundQueue.js'

/** @type {Map<string, Set<(value: unknown) => void>>} */
const subscriptions = new Map()

/**
 * Subscribe to a hub binding key. Immediately requests the current value.
 * Returns an unsubscribe function.
 * @param {string} key
 * @param {(value: unknown) => void} callback
 * @returns {() => void}
 */
export function subscribeBinding (key, callback) {
  let set = subscriptions.get(key)
  if (!set) {
    set = new Set()
    subscriptions.set(key, set)
  }
  set.add(callback)
  sendBindingSubscribe(key)
  return () => set.delete(callback)
}

/**
 * Apply an incoming binding:value payload from the hub.
 * @param {unknown} payload
 */
export function applyBindingValue (payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return
  const key = /** @type {Record<string,unknown>} */ (payload).key
  if (typeof key !== 'string') return
  const value = /** @type {Record<string,unknown>} */ (payload).value
  const set = subscriptions.get(key)
  if (!set) return
  for (const cb of set) cb(value)
}

/**
 * Re-subscribe all active bindings after a reconnect.
 * The hub discards slave state on disconnect.
 */
export function resubscribeAll () {
  for (const key of subscriptions.keys()) sendBindingSubscribe(key)
}
