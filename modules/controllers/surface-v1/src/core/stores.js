/**
 * @typedef {object} HubSpatialState
 * @property {number} x1
 * @property {number} y1
 * @property {number} z1
 * @property {number} x2
 * @property {number} y2
 * @property {number} z2
 */

/** @type {Map<string, unknown>} keyed by intent guid */
const intentState = new Map()

/** @type {Map<string, { zoneName: string, fixtureName: string, position: [number, number, number] }>} keyed by zoneName::fixtureName */
const fixtureState = new Map()

/** @type {Record<string, Record<string, unknown>>} controller-side switches per object guid */
const allowances = Object.create(null)

/** @type {HubSpatialState | null} */
let hubSpatial = null

/** @type {number[][]} */
let hubZoneBoxes = []

/** @type {Set<() => void>} */
const listeners = new Set()

function notifyListeners () {
  for (const fn of listeners) fn()
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

/**
 * @param {() => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribeToStores (fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ─── Property accessors ────────────────────────────────────────────────────────

/** @param {unknown} intent @returns {string} */
export function intentGuid (intent) {
  return intent !== null && typeof intent === 'object' && !Array.isArray(intent)
    ? String(/** @type {Record<string, unknown>} */ (intent).guid ?? '')
    : ''
}

/** @param {unknown} intent @returns {number} */
export function intentLayer (intent) {
  if (intent === null || typeof intent !== 'object' || Array.isArray(intent)) return NaN
  return Number(/** @type {Record<string, unknown>} */ (intent).layer)
}

/** @param {unknown} intent @returns {string} */
export function intentName (intent) {
  return intent !== null && typeof intent === 'object' && !Array.isArray(intent)
    ? String(/** @type {Record<string, unknown>} */ (intent).name ?? '')
    : ''
}

/** @param {unknown} intent @returns {number} */
export function intentRadius (intent) {
  if (intent === null || typeof intent !== 'object' || Array.isArray(intent)) return 0
  const raw = /** @type {Record<string, unknown>} */ (intent).radius
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
}

/**
 * @param {string} zoneName
 * @param {string} fixtureName
 * @returns {string}
 */
export function fixtureId (zoneName, fixtureName) {
  return `${zoneName}::${fixtureName}`
}

// ─── State getters ─────────────────────────────────────────────────────────────

export function getIntents () { return intentState }
export function getFixtures () { return fixtureState }
export function getAllowances () { return allowances }
export function getSpatial () { return hubSpatial }
export function getZoneBoxes () { return hubZoneBoxes }

// ─── Allowances ────────────────────────────────────────────────────────────────

/**
 * @param {string} guid
 * @param {string} key
 * @param {unknown} value
 */
export function setAllowance (guid, key, value) {
  if (!allowances[guid]) allowances[guid] = Object.create(null)
  allowances[guid][key] = value
  notifyListeners()
}

// ─── Position updates ──────────────────────────────────────────────────────────

/**
 * @param {string} guid
 * @param {number} wx
 * @param {number} wz
 * @returns {unknown | null}
 */
export function updateIntentPosition (guid, wx, wz) {
  const intent = intentState.get(guid)
  if (!intent) return null
  const i = /** @type {Record<string, unknown>} */ (intent)
  const pos = /** @type {number[] | undefined} */ (i.position)
  const updated = { ...i, position: [wx, pos?.[1] ?? 0, wz] }
  intentState.set(guid, updated)
  return updated
}

/**
 * @param {string} id
 * @param {number} wx
 * @param {number} wz
 * @returns {{ zoneName: string, fixtureName: string, position: [number, number, number] } | null}
 */
export function updateFixturePosition (id, wx, wz) {
  const fixture = fixtureState.get(id)
  if (!fixture) return null
  const updated = { ...fixture, position: /** @type {[number, number, number]} */ ([wx, fixture.position[1] ?? 0, wz]) }
  fixtureState.set(id, updated)
  return updated
}

// ─── Reconciliation ────────────────────────────────────────────────────────────

/**
 * @param {unknown[]} incomingIntents
 * @param {((intent: unknown) => void) | null} queueFn  pass null to skip queueing
 * @param {{ pruneMissing?: boolean }} [opts]
 */
export function reconcileIntents (incomingIntents, queueFn, { pruneMissing = true } = {}) {
  const incoming = new Map()
  for (const intent of incomingIntents) {
    const guid = intentGuid(intent)
    if (!guid) continue
    incoming.set(guid, intent)
  }
  for (const [guid, intent] of incoming) {
    const existing = intentState.get(guid)
    if (!existing || JSON.stringify(existing) !== JSON.stringify(intent)) {
      intentState.set(guid, intent)
      queueFn?.(intent)
    }
  }
  if (pruneMissing) {
    for (const guid of intentState.keys()) {
      if (!incoming.has(guid)) intentState.delete(guid)
    }
  }
  notifyListeners()
}

// ─── Hub config processing ─────────────────────────────────────────────────────

/**
 * @param {unknown} payload
 * @param {string} rendererGuid
 * @returns {{ spatial: HubSpatialState | null, zoneBoxes: number[][] }}
 */
export function processHubConfig (payload, rendererGuid) {
  hubSpatial = spatialStateFromConfig(payload, rendererGuid)
  hubZoneBoxes = zoneBoxesFromConfig(payload, rendererGuid)
  const fixtures = fixturesFromConfig(payload, rendererGuid)
  fixtureState.clear()
  for (const [id, fixture] of fixtures) fixtureState.set(id, fixture)
  notifyListeners()
  return { spatial: hubSpatial, zoneBoxes: hubZoneBoxes }
}

/**
 * @param {unknown} payload
 * @param {string} rendererGuid
 * @returns {HubSpatialState | null}
 */
function spatialStateFromConfig (payload, rendererGuid) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  const p = /** @type {Record<string, unknown>} */ (payload)
  const zones = p.zones
  if (!Array.isArray(zones)) return null
  const zoneToRenderer = /** @type {Record<string, string[]>} */ (p.zoneToRenderer ?? {})
  /** @type {number[][]} */
  const matched = []
  for (const z of zones) {
    if (z === null || typeof z !== 'object' || Array.isArray(z)) continue
    const zone = /** @type {Record<string, unknown>} */ (z)
    const assignedRenderers = zoneToRenderer[String(zone.name ?? '')]
    if (!Array.isArray(assignedRenderers) || !assignedRenderers.includes(rendererGuid)) continue
    const bb = zone.boundingBox
    if (!Array.isArray(bb) || bb.length < 6) continue
    matched.push(bb.map(n => Number(n)))
  }
  if (matched.length === 0) return null
  let x1 = Infinity, y1 = Infinity, z1 = Infinity
  let x2 = -Infinity, y2 = -Infinity, z2 = -Infinity
  for (const b of matched) {
    x1 = Math.min(x1, b[0]); y1 = Math.min(y1, b[1]); z1 = Math.min(z1, b[2])
    x2 = Math.max(x2, b[3]); y2 = Math.max(y2, b[4]); z2 = Math.max(z2, b[5])
  }
  return { x1, y1, z1, x2, y2, z2 }
}

/**
 * @param {unknown} payload
 * @param {string} rendererGuid
 * @returns {number[][]}
 */
function zoneBoxesFromConfig (payload, rendererGuid) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return []
  const p = /** @type {Record<string, unknown>} */ (payload)
  const zones = p.zones
  if (!Array.isArray(zones)) return []
  const zoneToRenderer = /** @type {Record<string, string[]>} */ (p.zoneToRenderer ?? {})
  /** @type {number[][]} */
  const matched = []
  for (const z of zones) {
    if (z === null || typeof z !== 'object' || Array.isArray(z)) continue
    const zone = /** @type {Record<string, unknown>} */ (z)
    const assignedRenderers = zoneToRenderer[String(zone.name ?? '')]
    if (!Array.isArray(assignedRenderers) || !assignedRenderers.includes(rendererGuid)) continue
    const bb = zone.boundingBox
    if (!Array.isArray(bb) || bb.length < 6) continue
    matched.push(bb.map(n => Number(n)))
  }
  return matched
}

/**
 * @param {unknown} payload
 * @param {string} rendererGuid
 * @returns {Map<string, { zoneName: string, fixtureName: string, position: [number, number, number] }>}
 */
function fixturesFromConfig (payload, rendererGuid) {
  /** @type {Map<string, { zoneName: string, fixtureName: string, position: [number, number, number] }>} */
  const fixtures = new Map()
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return fixtures
  const p = /** @type {Record<string, unknown>} */ (payload)
  const zones = p.zones
  if (!Array.isArray(zones)) return fixtures
  const zoneToRenderer = /** @type {Record<string, string[]>} */ (p.zoneToRenderer ?? {})
  for (const z of zones) {
    if (z === null || typeof z !== 'object' || Array.isArray(z)) continue
    const zone = /** @type {Record<string, unknown>} */ (z)
    const zoneName = String(zone.name ?? '')
    const assignedRenderers = zoneToRenderer[zoneName]
    if (!Array.isArray(assignedRenderers) || !assignedRenderers.includes(rendererGuid)) continue
    const bb = zone.boundingBox
    const zoneFixtures = zone.fixtures
    if (!Array.isArray(bb) || bb.length < 6 || !Array.isArray(zoneFixtures)) continue
    for (const fixtureRaw of zoneFixtures) {
      if (fixtureRaw === null || typeof fixtureRaw !== 'object' || Array.isArray(fixtureRaw)) continue
      const fixture = /** @type {Record<string, unknown>} */ (fixtureRaw)
      const fName = String(fixture.name ?? '')
      const local = fixture.location
      if (!fName || !Array.isArray(local) || local.length < 3) continue
      fixtures.set(fixtureId(zoneName, fName), {
        zoneName,
        fixtureName: fName,
        position: [
          Number(bb[0]) + Number(local[0]),
          Number(bb[1]) + Number(local[1]),
          Number(bb[2]) + Number(local[2])
        ]
      })
    }
  }
  return fixtures
}
