import { connect } from '../core/socket.js'
import { setSocket, setMinInterval } from '../core/outboundQueue.js'
import { projectGraph } from '../core/projectGraph.js'
import { applyIntentLockFromHub } from '../core/intentLockRegistry.js'
import { markStageOverlayActivity } from '../stage/stageOverlayHost.js'
import * as statusDisplay from './statusDisplay.js'

/**
 * @typedef {import('./config.js').AppConfig} AppConfig
 */

const hubOverlayRedrawTypes = new Set([
  'config',
  'graph:init',
  'graph:delta',
  'intents',
  'projectPatch',
  'lock:intent',
  'runtime:update'
])

/**
 * @param {AppConfig} appCfg
 */
export function connectStageHub (appCfg) {
  /** @type {Map<string, unknown>} */
  const pendingRuntimeUpdates = new Map()
  let runtimeFlushScheduled = false

  function flushPendingRuntimeUpdatesImmediate () {
    if (pendingRuntimeUpdates.size === 0) return
    const updatesToApply = [...pendingRuntimeUpdates.values()]
    pendingRuntimeUpdates.clear()
    projectGraph.applyRuntimeUpdate(updatesToApply)
    markStageOverlayActivity()
  }

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
      if (pendingRuntimeUpdates.size === 0) return
      const updatesToApply = [...pendingRuntimeUpdates.values()]
      pendingRuntimeUpdates.clear()
      projectGraph.applyRuntimeUpdate(updatesToApply)
      markStageOverlayActivity()
    })
  }

  const parts = appCfg.geoLocation.split(/\s+/).map(Number)
  const geoLon = parts[0] ?? 0
  const geoLat = parts[1] ?? 0
  const location = [geoLon, geoLat]

  connect(appCfg.hubUrl, {
    onOpen (ws) {
      setSocket(ws, location)
      ws.send(
        JSON.stringify({
          message: {
            type: 'register',
            location,
            payload: {
              role: 'controller',
              guid: appCfg.controllerGuid,
              scope: [],
              subscribe: { runtime: true }
            }
          }
        })
      )
      statusDisplay.info(
        'registered as controller — waiting for config…',
        'connection'
      )
    },

    onMessage (message) {
      switch (message.type) {
        case 'config': {
          const payload = message.payload
          projectGraph.applyConfig(payload, appCfg.simulatorRendererGuid)
          const rateLimit = /** @type {Record<string, unknown>} */ (
            payload ?? {}
          ).rateLimitEventsPerSecond
          if (typeof rateLimit === 'number' && rateLimit > 0) {
            setMinInterval(1000 / rateLimit)
          }
          const intents = Array.isArray(
            /** @type {Record<string, unknown>} */ (payload ?? {}).intents
          )
            ? /** @type {unknown[]} */ (
                /** @type {Record<string, unknown>} */ (payload).intents
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
          projectGraph.applyGraphInit(payload, appCfg.simulatorRendererGuid)
          const rateLimit = /** @type {Record<string, unknown>} */ (
            payload ?? {}
          ).rateLimitEventsPerSecond
          if (typeof rateLimit === 'number' && rateLimit > 0) {
            setMinInterval(1000 / rateLimit)
          }
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
          const pp = /** @type {Record<string, unknown>} */ (
            message.payload ?? {}
          )
          if (typeof pp.key === 'string') {
            projectGraph.applyPatch(pp.key, pp.data)
          }
          break
        }
        case 'lock:intent': {
          const p = /** @type {Record<string, unknown>} */ (message.payload ?? {})
          const guid = typeof p.guid === 'string' ? p.guid : ''
          const reason = typeof p.reason === 'string' ? p.reason : ''
          if (reason === 'animation-stopped') {
            flushPendingRuntimeUpdatesImmediate()
          }
          applyIntentLockFromHub(guid, reason)
          break
        }
      }
      if (hubOverlayRedrawTypes.has(message.type)) {
        markStageOverlayActivity()
      }
    },

    onClose () {
      statusDisplay.warn(
        'WebSocket disconnected — reconnecting…',
        'connection'
      )
    }
  })

  window.addEventListener(
    'pointerdown',
    () => {
      markStageOverlayActivity()
    },
    { capture: true, passive: true }
  )
}
