import { intentGuid, fixtureId } from './stores.js'
import { sceneActivateOptsWithAutoReset } from '../perform/sceneAutoResetPreference.js'

/** @type {WebSocket | null} */
let activeWs = null
/** @type {number[] | null} */
let activeLocation = null

/**
 * @param {WebSocket} ws
 * @param {number[]} location
 */
export function setSocket (ws, location) {
  activeWs = ws
  activeLocation = location
}

/**
 * Optional client-side spacing between batched runtime sends (legacy API).
 * Unused — every outbound message is sent immediately.
 * @param {number} _ms
 */
export function setMinInterval (_ms) {}

/** @param {unknown} intent */
export function queueIntentUpdate (intent) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation) return
  const record = /** @type {Record<string, unknown>} */ (intent)
  const guid = String(record.guid ?? intentGuid(intent))
  if (!guid) return
  const command = mergeGraphCommand(undefined, {
    entityType: 'intent',
    guid,
    patch: /** @type {Record<string, unknown> | undefined} */ (record.patch),
    remove: /** @type {string[] | undefined} */ (record.remove),
    value: record.patch || record.remove ? undefined : record
  })
  sendRuntimeCommands([command], activeWs, activeLocation)
}

/**
 * Perform drag of an intent: a `drag:'move'` runtime:command so the hub springs the intent to a
 * physics drag anchor (mass-based lag, connected intents follow). @param {string} guid @param {[number,number,number]} position
 */
export function queueIntentDragMove (guid, position) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation || !guid) return
  sendRuntimeCommands(
    [{ entityType: 'intent', guid, patch: { position }, drag: 'move' }],
    activeWs,
    activeLocation
  )
}

/** Release a perform drag on pointer-up; the hub drops the anchor immediately. @param {string} guid */
export function queueIntentDragEnd (guid) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation || !guid) return
  sendRuntimeCommands(
    [{ entityType: 'intent', guid, drag: 'end' }],
    activeWs,
    activeLocation
  )
}

/** @param {unknown} fixtureUpdate */
export function queueFixtureUpdate (fixtureUpdate) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation) return
  const f = /** @type {Record<string, unknown>} */ (fixtureUpdate)
  const guid = String(f.guid ?? '')
  const id = guid || fixtureId(String(f.zoneName ?? ''), String(f.fixtureName ?? ''))
  if (!id || !guid) return
  sendGraphCommands(
    [{
      op: 'patch',
      entityType: 'fixture',
      guid,
      patch: { position: f.position },
      persistence: 'runtimeAndDurable'
    }],
    activeWs,
    activeLocation
  )
}

/**
 * Enable or disable the hub physics solver from the edit pane Physics toggle (perform always on).
 * @param {boolean} enabled
 */
export function queuePhysicsEnabled (enabled) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation) return
  sendRuntimeCommands(
    [{ entityType: 'physics', guid: 'master', patch: { enabled } }],
    activeWs,
    activeLocation
  )
}

/**
 * Set a hub-wide GlobalState key. Subsystems subscribed to that key react on the hub
 * (e.g. `editmode` pauses/resumes animations and pulses). Transient — never persisted to YAML.
 * @param {'editmode'} key
 * @param {boolean} value
 */
export function sendGlobalStateSet (key, value) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation) return
  activeWs.send(
    JSON.stringify({ message: { type: 'globalState:set', location: activeLocation, payload: { key, value } } })
  )
}

/**
 * Durable patch of instance-level fixture fields (root params + nested `params`) by dot-path.
 * Distinct from {@link queueFixtureUpdate}, which streams only `position` for stage drags.
 * @param {string} guid
 * @param {Record<string, unknown>} [patch]
 * @param {string[]} [remove]
 */
export function queueFixturePropertyUpdate (guid, patch, remove) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation) return
  if (!guid) return
  sendGraphCommands(
    [{
      op: 'patch',
      entityType: 'fixture',
      guid,
      ...(patch ? { patch } : {}),
      ...(remove && remove.length > 0 ? { remove } : {}),
      persistence: 'runtimeAndDurable'
    }],
    activeWs,
    activeLocation
  )
}

/**
 * Durable removal of a fixture instance from its zone.
 * @param {string} guid
 */
export function queueFixtureRemove (guid) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation) return
  if (!guid) return
  sendGraphCommands(
    [{
      op: 'remove',
      entityType: 'fixture',
      guid,
      persistence: 'runtimeAndDurable'
    }],
    activeWs,
    activeLocation
  )
}

/**
 * @param {unknown[]} commands
 * @param {WebSocket} ws
 * @param {number[]} location
 */
function sendGraphCommands (commands, ws, location) {
  if (ws.readyState !== WebSocket.OPEN) return
  for (const command of commands) {
    ws.send(
      JSON.stringify({ message: { type: 'graph:command', location, payload: command } })
    )
  }
}

/**
 * @param {unknown[]} commands
 * @param {WebSocket} ws
 * @param {number[]} location
 */
function sendRuntimeCommands (commands, ws, location) {
  if (ws.readyState !== WebSocket.OPEN) return
  for (const command of commands) {
    ws.send(
      JSON.stringify({ message: { type: 'runtime:command', location, payload: command } })
    )
  }
}

/**
 * @param {string} sceneGuid
 * @param {{
 *   clearRuntimeIntentMerge?: boolean,
 *   runtimeMergeClear?: 'scene' | 'all'
 * }} [opts]
 */
export function sendSceneActivate (sceneGuid, opts = {}) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation)
    return
  const mergedOpts = sceneActivateOptsWithAutoReset(opts)
  const patch = /** @type {Record<string, unknown>} */ ({
    activeSceneGuid: sceneGuid
  })
  const rmc = mergedOpts.runtimeMergeClear
  if (rmc === 'all' || rmc === 'scene') {
    patch.runtimeMergeClear = rmc
  } else if (mergedOpts.clearRuntimeIntentMerge) {
    patch.runtimeMergeClear = 'scene'
  }
  activeWs.send(
    JSON.stringify({
      message: {
        type: 'graph:command',
        location: activeLocation,
        payload: {
          op: 'patch',
          entityType: 'project',
          guid: 'active',
          patch,
          persistence: 'runtimeAndDurable'
        }
      }
    })
  )
}

/**
 * @param {string} key
 * @param {unknown} data
 */
export function sendSaveProject (key, data) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation)
    return
  const commands = saveProjectCommands(key, data)
  sendGraphCommands(commands, activeWs, activeLocation)
}

/**
 * @param {Record<string, unknown>} command
 */
export function sendGraphCommand (command) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation)
    return
  sendGraphCommands([command], activeWs, activeLocation)
}

/** @param {Record<string, unknown>} command */
export function sendActionInputCommand (command) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation)
    return
  activeWs.send(JSON.stringify({
    message: {
      type: 'action:input',
      location: activeLocation,
      payload: command
    }
  }))
}

/** @param {Record<string, unknown>} command */
export function sendPulseAssignCommand (command) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation)
    return
  activeWs.send(JSON.stringify({
    message: {
      type: 'pulse:assign',
      location: activeLocation,
      payload: command
    }
  }))
}

/** @param {Record<string, unknown>} command */
export function sendPulseControlCommand (command) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation)
    return
  activeWs.send(JSON.stringify({
    message: {
      type: 'pulse:control',
      location: activeLocation,
      payload: command
    }
  }))
}

/**
 * @param {{ name: string, recall: { scene: boolean, pulse: boolean, animations: boolean }, guid?: string }} payload
 */
export function sendSnapshotCapture (payload) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation)
    return
  activeWs.send(JSON.stringify({
    message: {
      type: 'snapshot:capture',
      location: activeLocation,
      payload
    }
  }))
}

/**
 * @param {string} guid
 * @param {{ name?: string, recall?: { scene: boolean, pulse: boolean, animations: boolean } }} patch
 */
export function sendSnapshotMetadataPatch (guid, patch) {
  sendGraphCommand({
    op: 'patch',
    entityType: 'snapshot',
    guid,
    patch,
    persistence: 'runtimeAndDurable'
  })
}

/** @param {string} guid */
export function sendSnapshotRemove (guid) {
  sendGraphCommand({
    op: 'remove',
    entityType: 'snapshot',
    guid,
    persistence: 'runtimeAndDurable'
  })
}

/** @param {{ setupGuid: string, atMs?: number }} payload */
export function sendPulseTap (payload) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation)
    return
  activeWs.send(JSON.stringify({
    message: {
      type: 'pulse:tap',
      location: activeLocation,
      payload
    }
  }))
}

/** @param {string} key */
export function sendBindingSubscribe (key) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation) return
  activeWs.send(JSON.stringify({ message: { type: 'binding:subscribe', location: activeLocation, payload: { key } } }))
}

/**
 * @param {string} key
 * @param {unknown} value
 */
export function sendBindingSet (key, value) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation) return
  activeWs.send(JSON.stringify({ message: { type: 'binding:set', location: activeLocation, payload: { key, value } } }))
}

/**
 * Toggle live edit mode for a keyframe-style animation. Hub installs/removes the
 * animator-owned editState binding in response.
 * @param {string} animationGuid
 * @param {boolean} on
 */
export function sendAnimationEdit (animationGuid, on) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation) return
  activeWs.send(JSON.stringify({
    message: {
      type: 'animation:edit',
      location: activeLocation,
      payload: { animationGuid, on: !!on }
    }
  }))
}

/**
 * @param {string} actionGuid
 * @param {Record<string, unknown>=} args
 */
export function sendDiscoverySubscribe () {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return
  activeWs.send(JSON.stringify({
    message: { type: 'discovery:subscribe', payload: {} }
  }))
}

/**
 * Send a correlated `system:probe` read-only query to the hub.
 * @param {{ requestId: string, query: string, args?: unknown }} payload
 * @returns {boolean} whether the message was sent
 */
export function sendSystemProbe (payload) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return false
  activeWs.send(JSON.stringify({ message: { type: 'system:probe', payload } }))
  return true
}

export function sendActionTrigger (actionGuid, args) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation)
    return
  /** @type {Record<string, unknown>} */
  const payload = { actionGuid }
  if (args && typeof args === 'object' && !Array.isArray(args))
    payload.args = args
  activeWs.send(JSON.stringify({
    message: {
      type: 'action:trigger',
      location: activeLocation,
      payload
    }
  }))
}

/**
 * @param {string} key
 * @param {unknown} data
 * @returns {unknown[]}
 */
function saveProjectCommands (key, data) {
  if (key === 'intents' && Array.isArray(data)) {
    return data
      .map(value => /** @type {Record<string, unknown>} */ (value))
      .filter(value => typeof value.guid === 'string')
      .map(value => ({
        op: 'upsert',
        entityType: 'intent',
        guid: String(value.guid),
        value,
        persistence: 'runtimeAndDurable'
      }))
  }
  if (key === 'scenes' && Array.isArray(data)) {
    return data
      .map(value => /** @type {Record<string, unknown>} */ (value))
      .filter(value => typeof value.guid === 'string')
      .map(value => ({
        op: 'upsert',
        entityType: 'scene',
        guid: String(value.guid),
        value,
        persistence: 'runtimeAndDurable'
      }))
  }
  return []
}

/**
 * @param {Record<string, unknown> | undefined} existing
 * @param {Record<string, unknown>} next
 * @returns {Record<string, unknown>}
 */
function mergeGraphCommand (existing, next) {
  if (!existing) return next
  return {
    ...next,
    patch: {
      .../** @type {Record<string, unknown>} */ (existing.patch ?? {}),
      .../** @type {Record<string, unknown>} */ (next.patch ?? {})
    },
    remove: [
      .../** @type {string[]} */ (existing.remove ?? []),
      .../** @type {string[]} */ (next.remove ?? [])
    ]
  }
}
