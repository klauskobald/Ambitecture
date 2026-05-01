import { loadConfig, applyLayoutCssVars } from '../core/config.js'
import { projectGraph } from '../core/projectGraph.js'
import {
  setSocket,
  queueIntentUpdate,
  setMinInterval,
  sendSceneActivate
} from '../core/outboundQueue.js'
import { connect } from '../core/socket.js'
import { SimulatorViewport } from '../viewport/simulatorViewport.js'
import { OverlayCanvas } from '../viewport/overlayCanvas.js'
import { initNav, activateDefaultNav } from './nav.js'
import { initRouter, navigateTo } from './router.js'
import * as statusDisplay from './statusDisplay.js'

async function main () {
  const cfg = await loadConfig()
  if (!cfg) return

  applyLayoutCssVars(cfg.LAYOUT)

  const iframe = /** @type {HTMLIFrameElement | null} */ (
    document.getElementById('sim-frame')
  )
  const stack = document.getElementById('sim-stack')
  const canvas = /** @type {HTMLCanvasElement | null} */ (
    document.getElementById('touch-overlay')
  )

  if (!iframe || !stack || !canvas) {
    statusDisplay.error(
      'Missing #sim-frame, #sim-stack, or #touch-overlay in DOM.',
      'dom'
    )
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
      ws.send(
        JSON.stringify({
          message: {
            type: 'register',
            location,
            payload: {
              role: 'controller',
              guid: cfg.CONTROLLER_GUID,
              scope: []
            }
          }
        })
      )
      statusDisplay.info(
        'registered as controller - waiting for config...',
        'connection'
      )
    },

    onMessage (message) {
      switch (message.type) {
        case 'config': {
          const payload = message.payload
          projectGraph.applyConfig(payload, cfg.SIMULATOR_RENDERER_GUID)
          const rateLimit = /** @type {Record<string,unknown>} */ (
            payload ?? {}
          ).rateLimitEventsPerSecond
          if (typeof rateLimit === 'number' && rateLimit > 0)
            setMinInterval(1000 / rateLimit)
          const intents = Array.isArray(
            /** @type {Record<string,unknown>} */ (payload ?? {}).intents
          )
            ? /** @type {unknown[]} */ (
                /** @type {Record<string,unknown>} */ (payload).intents
              )
            : []
          projectGraph.reconcileIntents(intents, null)
          statusDisplay.info(
            projectGraph.getSpatial()
              ? 'config received'
              : 'config received but no zone for SIMULATOR_RENDERER_GUID',
            'config'
          )
          break
        }
        case 'refresh': {
          const activeName = projectGraph.getActiveSceneName()
          if (activeName) sendSceneActivate(activeName)
          break
        }
        case 'intents': {
          const incoming = Array.isArray(message.payload)
            ? /** @type {unknown[]} */ (message.payload)
            : []
          projectGraph.reconcileIntents(incoming, null, { pruneMissing: false })
          break
        }
        case 'scene:state': {
          const sp = /** @type {Record<string, unknown> | null} */ (
            message.payload
          )
          if (sp && typeof sp.sceneName === 'string') {
            projectGraph.setActiveScene(sp.sceneName)
          }
          break
        }
      }
    },

    onClose () {
      statusDisplay.warn(
        'WebSocket disconnected - reconnecting...',
        'connection'
      )
    }
  })

  activateDefaultNav(paneName => navigateTo(paneName))

  window.dev = {
    projectState () {
      console.log(JSON.stringify(projectGraph.toJSON(), null, 2))
    }
  }
}

main()
