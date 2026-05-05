import { loadConfig, applyLayoutCssVars } from '../core/config.js'
import { applySystemCapabilities } from '../core/systemCapabilities.js'
import { projectGraph } from '../core/projectGraph.js'
import { setSocket, setMinInterval, sendSceneActivate } from '../core/outboundQueue.js'
import { connect } from '../core/socket.js'
import { SimulatorViewport } from '../viewport/simulatorViewport.js'
import { OverlayCanvas } from '../viewport/overlayCanvas.js'
import { initNav, activateDefaultNav } from './nav.js'
import { initRouter, navigateTo } from './router.js'
import * as statusDisplay from './statusDisplay.js'

/** @type {Map<string, unknown>} */
const pendingRuntimeUpdates = new Map()
let runtimeFlushScheduled = false

/** @param {unknown} payload */
function queueRuntimeUpdate (payload) {
  const updates = Array.isArray(payload) ? payload : [payload]
  for (const raw of updates) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const update = /** @type {Record<string, unknown>} */ (raw)
    const entityType = String(update.entityType ?? '')
    const guid = String(update.guid ?? '')
    if (!entityType || !guid) continue
    pendingRuntimeUpdates.set(`${entityType}:${guid}`, update)
  }
  if (runtimeFlushScheduled) return
  runtimeFlushScheduled = true
  requestAnimationFrame(() => {
    runtimeFlushScheduled = false
    const updatesToApply = [...pendingRuntimeUpdates.values()]
    pendingRuntimeUpdates.clear()
    if (updatesToApply.length > 0) projectGraph.applyRuntimeUpdate(updatesToApply)
  })
}

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

  const overlayResetWrap = /** @type {HTMLElement | null} */ (
    document.getElementById('runtime-overlay-reset-wrap')
  )
  const overlayResetBtn = /** @type {HTMLButtonElement | null} */ (
    document.getElementById('runtime-overlay-reset-btn')
  )

  /** Sync hub runtime-overlay hint strip above sim bottom edge */
  function syncRuntimeOverlayResetUi () {
    if (!overlayResetWrap) return
    const guids = projectGraph.getRuntimeOverlayGuidsInScene()
    const active = projectGraph.getActiveSceneName()
    overlayResetWrap.hidden =
      !(guids.length > 0 && typeof active === 'string' && active.length > 0)
  }

  overlayResetBtn?.addEventListener('click', () => {
    const name = projectGraph.getActiveSceneName()
    if (typeof name !== 'string' || name.length === 0) return
    sendSceneActivate(name, { clearRuntimeIntentMerge: true })
  })
  projectGraph.subscribe(syncRuntimeOverlayResetUi)
  syncRuntimeOverlayResetUi()

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
        case 'graph:init': {
          const payload = message.payload
          projectGraph.applyGraphInit(payload, cfg.SIMULATOR_RENDERER_GUID)
          const rateLimit = /** @type {Record<string,unknown>} */ (
            payload ?? {}
          ).rateLimitEventsPerSecond
          if (typeof rateLimit === 'number' && rateLimit > 0)
            setMinInterval(1000 / rateLimit)
          statusDisplay.info(
            projectGraph.getSpatial()
              ? 'graph initialized'
              : 'graph initialized but no zone for SIMULATOR_RENDERER_GUID',
            'config'
          )
          break
        }
        case 'graph:delta': {
          projectGraph.applyGraphDelta(message.payload)
          break
        }
        case 'runtime:update': {
          queueRuntimeUpdate(message.payload)
          break
        }
        case 'intents': {
          const incoming = Array.isArray(message.payload)
            ? /** @type {unknown[]} */ (message.payload)
            : []
          projectGraph.reconcileIntents(incoming, null, { pruneMissing: false })
          break
        }
        case 'projectPatch': {
          const pp = /** @type {Record<string, unknown>} */ (message.payload ?? {})
          if (typeof pp.key === 'string') {
            projectGraph.applyPatch(pp.key, pp.data)
          }
          break
        }
        case 'systemCapabilities': {
          applySystemCapabilities(message.payload)
          projectGraph.notifyListeners()
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
