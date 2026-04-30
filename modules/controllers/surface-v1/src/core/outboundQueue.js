import { intentGuid, fixtureId } from './stores.js'

/** @type {Map<string, unknown>} */
const outboundMap = new Map()
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
  const guid = intentGuid(intent)
  if (!guid) return
  outboundMap.set(guid, intent)
  scheduleFlush()
}

/** @param {unknown} fixtureUpdate */
export function queueFixtureUpdate (fixtureUpdate) {
  const f = /** @type {Record<string, unknown>} */ (fixtureUpdate)
  const id = fixtureId(String(f.zoneName ?? ''), String(f.fixtureName ?? ''))
  if (!id) return
  outboundFixtureMap.set(id, fixtureUpdate)
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
  const intents = [...outboundMap.values()]
  const fixtures = [...outboundFixtureMap.values()]
  if (intents.length === 0 && fixtures.length === 0) return
  outboundMap.clear()
  outboundFixtureMap.clear()
  lastSentAt = Date.now()
  if (intents.length > 0) sendIntents(intents, activeWs, activeLocation)
  if (fixtures.length > 0) sendFixtures(fixtures, activeWs, activeLocation)
}

/**
 * @param {unknown[]} intents
 * @param {WebSocket} ws
 * @param {number[]} location
 */
function sendIntents (intents, ws, location) {
  if (ws.readyState !== WebSocket.OPEN) return
  ws.send(
    JSON.stringify({ message: { type: 'intents', location, payload: intents } })
  )
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
        type: 'scene:activate',
        location: activeLocation,
        payload: { sceneName }
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
  activeWs.send(
    JSON.stringify({
      message: {
        type: 'saveProject',
        location: activeLocation,
        payload: { key, data }
      }
    })
  )
}

/**
 * @param {unknown[]} fixtures
 * @param {WebSocket} ws
 * @param {number[]} location
 */
function sendFixtures (fixtures, ws, location) {
  if (ws.readyState !== WebSocket.OPEN) return
  ws.send(
    JSON.stringify({
      message: { type: 'fixtures', location, payload: fixtures }
    })
  )
}
