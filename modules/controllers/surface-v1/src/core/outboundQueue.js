import { intentGuid, fixtureId } from './stores.js'

/** @type {Map<string, unknown>} */
const outboundRuntimeMap = new Map()
/** @type {Map<string, unknown>} */
const outboundFixtureMap = new Map()
let lastSentAt = 0
let sendPending = false
let minIntervalMs = 40
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

/** @param {number} ms */
export function setMinInterval (ms) {
  minIntervalMs = ms
}

/** @param {unknown} intent */
export function queueIntentUpdate (intent) {
  const record = /** @type {Record<string, unknown>} */ (intent)
  const guid = String(record.guid ?? intentGuid(intent))
  if (!guid) return
  const existing = /** @type {Record<string, unknown> | undefined} */ (outboundRuntimeMap.get(guid))
  outboundRuntimeMap.set(guid, mergeGraphCommand(existing, {
    entityType: 'intent',
    guid,
    patch: /** @type {Record<string, unknown> | undefined} */ (record.patch),
    remove: /** @type {string[] | undefined} */ (record.remove),
    value: record.patch || record.remove ? undefined : record
  }))
  scheduleFlush()
}

/** @param {unknown} fixtureUpdate */
export function queueFixtureUpdate (fixtureUpdate) {
  const f = /** @type {Record<string, unknown>} */ (fixtureUpdate)
  const guid = String(f.guid ?? '')
  const id = guid || fixtureId(String(f.zoneName ?? ''), String(f.fixtureName ?? ''))
  if (!id || !guid) return
  outboundFixtureMap.set(id, {
    op: 'patch',
    entityType: 'fixture',
    guid,
    patch: { position: f.position },
    persistence: 'runtimeAndDurable'
  })
  scheduleFlush()
}

function scheduleFlush () {
  if (sendPending) return
  const elapsed = Date.now() - lastSentAt
  if (elapsed >= minIntervalMs) {
    flushOutbound()
  } else {
    sendPending = true
    setTimeout(() => {
      sendPending = false
      flushOutbound()
    }, minIntervalMs - elapsed)
  }
}

function flushOutbound () {
  if (!activeWs || !activeLocation) return
  const runtime = [...outboundRuntimeMap.values()]
  const fixtures = [...outboundFixtureMap.values()]
  if (runtime.length === 0 && fixtures.length === 0) return
  outboundRuntimeMap.clear()
  outboundFixtureMap.clear()
  lastSentAt = Date.now()
  sendRuntimeCommands(runtime, activeWs, activeLocation)
  sendGraphCommands(fixtures, activeWs, activeLocation)
}

/**
 * @param {unknown[]} intents
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
 * Sends scene:activate directly on the WebSocket (bypasses the rate-limited queue).
 * @param {string} sceneName
 */
export function sendSceneActivate (sceneName) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation)
    return
  activeWs.send(
    JSON.stringify({
      message: {
        type: 'graph:command',
        location: activeLocation,
        payload: {
          op: 'patch',
          entityType: 'project',
          guid: 'active',
          patch: { activeSceneName: sceneName },
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

/** @param {string} actionGuid */
export function sendActionTrigger (actionGuid) {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !activeLocation)
    return
  activeWs.send(JSON.stringify({
    message: {
      type: 'action:trigger',
      location: activeLocation,
      payload: { actionGuid }
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
