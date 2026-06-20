import { sendSystemProbe } from './outboundQueue.js'

const DEFAULT_TIMEOUT_MS = 8000

/**
 * Client side of the hub `system:probe` request/response endpoint. Issues a
 * correlated query and resolves when the matching `system:probe:result` arrives.
 * `resolveResult` is fed by the inbound hub message handler.
 *
 * @typedef {{ resolve: (data: unknown) => void, reject: (err: Error) => void, timer: ReturnType<typeof setTimeout> }} PendingProbe
 */
class HubProbe {
  constructor () {
    /** @type {Map<string, PendingProbe>} */
    this._pending = new Map()
    this._seq = 0
  }

  /**
   * @param {string} query  registered hub query name
   * @param {unknown} [args]
   * @param {number} [timeoutMs]
   * @returns {Promise<unknown>}
   */
  probe (query, args, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const requestId = `probe-${++this._seq}-${Date.now()}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(requestId)
        reject(new Error(`system:probe "${query}" timed out`))
      }, timeoutMs)
      this._pending.set(requestId, { resolve, reject, timer })
      const sent = sendSystemProbe({ requestId, query, args })
      if (!sent) {
        clearTimeout(timer)
        this._pending.delete(requestId)
        reject(new Error('hub socket not ready'))
      }
    })
  }

  /**
   * Settle the pending promise for an inbound `system:probe:result` payload.
   * @param {unknown} payload
   */
  resolveResult (payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return
    const p = /** @type {Record<string, unknown>} */ (payload)
    const requestId = typeof p.requestId === 'string' ? p.requestId : ''
    const entry = this._pending.get(requestId)
    if (!entry) return
    this._pending.delete(requestId)
    clearTimeout(entry.timer)
    if (p.ok) {
      entry.resolve(p.data)
    } else {
      entry.reject(new Error(typeof p.error === 'string' ? p.error : 'probe failed'))
    }
  }
}

export const hubProbe = new HubProbe()
