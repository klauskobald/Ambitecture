/**
 * @param {string} httpUrl
 * @returns {string}
 */
function toWsUrl (httpUrl) {
  return httpUrl.replace(/^http/, 'ws')
}

/**
 * @typedef {object} SocketHandlers
 * @property {(ws: WebSocket) => void} [onOpen]
 * @property {(message: Record<string, unknown>) => void} [onMessage]
 * @property {() => void} [onClose]
 */

/**
 * Connects to the hub WebSocket and reconnects immediately on any close/error.
 * Calls `handlers.onOpen(ws)` after each successful open so callers can
 * re-register and update any held WS reference.
 *
 * @param {string} hubUrl  HTTP or WS URL of the hub
 * @param {SocketHandlers} handlers
 * @returns {{ disconnect: () => void }}
 */
export function connect (hubUrl, handlers) {
  const wsUrl = toWsUrl(hubUrl)
  let stopped = false

  function attemptConnect () {
    if (stopped) return
    const ws = new WebSocket(wsUrl)

    ws.addEventListener('open', () => {
      handlers.onOpen?.(ws)
    })

    ws.addEventListener('message', evt => {
      let envelope
      try {
        envelope = JSON.parse(/** @type {string} */ (evt.data))
      } catch {
        return
      }
      const message = envelope?.message
      if (!message?.type) return
      handlers.onMessage?.(message)
    })

    ws.addEventListener('close', () => {
      handlers.onClose?.()
      if (!stopped) setTimeout(attemptConnect, 0)
    })

    ws.addEventListener('error', () => {
      // close event fires after error; reconnect is handled there
    })
  }

  attemptConnect()
  return { disconnect: () => { stopped = true } }
}
