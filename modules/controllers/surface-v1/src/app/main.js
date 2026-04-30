import { loadConfig, applyLayoutCssVars } from '../core/config.js'
import { processHubConfig, reconcileIntents, getIntents } from '../core/stores.js'
import { setSocket, queueIntentUpdate, setMinInterval } from '../core/outboundQueue.js'
import { connect } from '../core/socket.js'
import { SimulatorViewport } from '../viewport/simulatorViewport.js'
import { OverlayCanvas } from '../viewport/overlayCanvas.js'
import { initNav, activateDefaultNav } from './nav.js'
import { initRouter, navigateTo } from './router.js'
import { setSpatialReadout, showConfigError } from './statusDisplay.js'

async function main () {
  const cfg = await loadConfig()
  if (!cfg) return

  applyLayoutCssVars(cfg.LAYOUT)

  const iframe = /** @type {HTMLIFrameElement | null} */ (document.getElementById('sim-frame'))
  const stack = document.getElementById('sim-stack')
  const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('touch-overlay'))

  if (!iframe || !stack || !canvas) {
    showConfigError('Missing #sim-frame, #sim-stack, or #touch-overlay in DOM.')
    return
  }

  const viewport = new SimulatorViewport(iframe)
  viewport.setSrc(new URL(cfg.SIMULATOR_IFRAME_URL, window.location.href).href)

  const overlay = new OverlayCanvas(canvas, stack, viewport, cfg.LAYOUT)

  initRouter(overlay)
  initNav(paneName => navigateTo(paneName))

  const [geoLon, geoLat] = cfg.GEO_LOCATION.split(/\s+/).map(Number)
  const location = [geoLon, geoLat]

  connect(cfg.AMBITECTURE_HUB_URL, {
    onOpen (ws) {
      setSocket(ws, location)
      ws.send(JSON.stringify({
        message: {
          type: 'register',
          location,
          payload: { role: 'controller', guid: cfg.CONTROLLER_GUID, scope: [] }
        }
      }))
      setSpatialReadout('registered as controller — waiting for config…')
    },

    onMessage (message) {
      switch (message.type) {
        case 'config': {
          const payload = message.payload
          const { spatial } = processHubConfig(payload, cfg.SIMULATOR_RENDERER_GUID)
          const rateLimit = /** @type {Record<string,unknown>} */ (payload ?? {}).rateLimitEventsPerSecond
          if (typeof rateLimit === 'number' && rateLimit > 0) setMinInterval(1000 / rateLimit)
          const intents = Array.isArray(/** @type {Record<string,unknown>} */ (payload ?? {}).intents)
            ? /** @type {unknown[]} */ (/** @type {Record<string,unknown>} */ (payload).intents)
            : []
          reconcileIntents(intents, queueIntentUpdate)
          setSpatialReadout(
            spatial
              ? 'hub config received — drag on the touch overlay'
              : 'config received but no zone for SIMULATOR_RENDERER_GUID'
          )
          break
        }
        case 'refresh': {
          const all = [...getIntents().values()]
          // re-send all known intents so hub can refresh renderer state
          for (const intent of all) queueIntentUpdate(intent)
          break
        }
        case 'intents': {
          const incoming = Array.isArray(message.payload) ? /** @type {unknown[]} */ (message.payload) : []
          reconcileIntents(incoming, null, { pruneMissing: false })
          break
        }
      }
    },

    onClose () {
      setSpatialReadout('WebSocket disconnected — reconnecting…')
    }
  })

  activateDefaultNav(paneName => navigateTo(paneName))
}

main()
