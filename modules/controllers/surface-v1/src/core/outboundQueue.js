import { intentGuid, fixtureId } from './stores.js'

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
  const patch = /** @type {Record<string, unknown>} */ ({
    activeSceneGuid: sceneGuid
  })
  const rmc = opts.runtimeMergeClear
  if (rmc === 'all' || rmc === 'scene') {
    patch.runtimeMergeClear = rmc
  } else if (opts.clearRuntimeIntentMerge) {
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
