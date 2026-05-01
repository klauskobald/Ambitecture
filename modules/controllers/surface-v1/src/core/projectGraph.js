import { intentGuid, fixtureId } from './stores.js'

/**
 * @typedef {object} HubSpatialState
 * @property {number} x1
 * @property {number} y1
 * @property {number} z1
 * @property {number} x2
 * @property {number} y2
 * @property {number} z2
 */

class ProjectGraph {
  constructor () {
    this._rendererGuid = ''
    /** @type {Set<() => void>} */
    this._listeners = new Set()

    this._data = {
      projectName: '',
      zoneToRenderer: /** @type {Record<string, string[]>} */ ({}),
      zones: /** @type {unknown[]} */ ([]),
      intents: /** @type {Map<string, unknown>} */ (new Map()),
      scenes: /** @type {Array<{ name: string, intents: string[] }>} */ ([]),
      activeSceneName: /** @type {string | null} */ (null),
      controller: {
        intentConfig: /** @type {Map<string, Record<string, unknown>>} */ (new Map()),
      },
    }

    /** @type {HubSpatialState | null} */
    this._spatial = null
    /** @type {number[][]} */
    this._zoneBoxes = []
    /** @type {Map<string, { zoneName: string, fixtureName: string, position: [number, number, number] }>} */
    this._fixtures = new Map()
  }

  // ─── Subscriptions ────────────────────────────────────────────────────────────

  /** @param {() => void} fn @returns {() => void} unsubscribe */
  subscribe (fn) {
    this._listeners.add(fn)
    return () => this._listeners.delete(fn)
  }

  _notify () {
    for (const fn of this._listeners) fn()
  }

  // ─── Derived state ────────────────────────────────────────────────────────────

  /** @returns {HubSpatialState | null} */
  getSpatial () { return this._spatial }

  /** @returns {number[][]} */
  getZoneBoxes () { return this._zoneBoxes }

  /** @returns {Map<string, { zoneName: string, fixtureName: string, position: [number, number, number] }>} */
  getFixtures () { return this._fixtures }

  // ─── Project data ─────────────────────────────────────────────────────────────

  /** @returns {Map<string, unknown>} */
  getIntents () { return this._data.intents }

  /** @returns {string[]} */
  getScenes () { return this._data.scenes.map(s => s.name) }

  /** @param {string} sceneName @returns {string[]} guid list */
  getSceneIntents (sceneName) {
    return this._data.scenes.find(s => s.name === sceneName)?.intents ?? []
  }

  /** @returns {Array<{ name: string, intents: string[] }>} */
  getScenesData () { return this._data.scenes }

  /** @returns {string | null} */
  getActiveSceneName () { return this._data.activeSceneName }

  /** @param {string} guid @returns {Record<string, unknown>} */
  getIntentConfig (guid) {
    return this._data.controller.intentConfig.get(guid) ?? {}
  }

  // ─── Mutations ────────────────────────────────────────────────────────────────

  /** @param {string} name */
  setActiveScene (name) {
    this._data.activeSceneName = name
    this._notify()
  }

  /**
   * @param {string} name
   * @param {string | null} [cloneFromName] scene name to clone intents from
   * @returns {boolean} true if added, false if duplicate name
   */
  addScene (name, cloneFromName = null) {
    if (this._data.scenes.some(s => s.name === name)) return false
    let intents = /** @type {string[]} */ ([])
    if (cloneFromName) {
      const source = this._data.scenes.find(s => s.name === cloneFromName)
      if (source) intents = [...source.intents]
    }
    this._data.scenes.push({ name, intents })
    this._data.activeSceneName = name
    this._notify()
    return true
  }

  /** @param {string} name */
  removeScene (name) {
    const idx = this._data.scenes.findIndex(s => s.name === name)
    if (idx === -1) return
    this._data.scenes.splice(idx, 1)
    if (this._data.activeSceneName === name) {
      this._data.activeSceneName = this._data.scenes[0]?.name ?? null
    }
    this._notify()
  }

  /**
   * @param {string} sceneName
   * @param {string} guid
   */
  toggleSceneIntent (sceneName, guid) {
    const scene = this._data.scenes.find(s => s.name === sceneName)
    if (!scene) return
    const idx = scene.intents.indexOf(guid)
    if (idx === -1) {
      scene.intents.push(guid)
    } else {
      scene.intents.splice(idx, 1)
    }
    this._notify()
  }

  /**
   * @param {string} guid
   * @param {string} key
   * @param {unknown} value
   */
  setIntentConfig (guid, key, value) {
    const current = this._data.controller.intentConfig.get(guid) ?? Object.create(null)
    this._data.controller.intentConfig.set(guid, { ...current, [key]: value })
    this._notify()
  }

  /**
   * @param {string} guid
   * @param {unknown} rawPickerValue
   * @returns {unknown | null}
   */
  updateIntentColor (guid, rawPickerValue) {
    return this.updateIntentProperty(guid, 'params.color', rawPickerValue)
  }

  /**
   * Sets a nested property on an intent using dot-notation path.
   * @param {string} guid
   * @param {string} dotKey
   * @param {unknown} value
   * @returns {unknown | null}
   */
  updateIntentProperty (guid, dotKey, value) {
    const intent = this._data.intents.get(guid)
    if (!intent) return null
    const updated = this._cloneAndSetAtDotPath(/** @type {Record<string, unknown>} */ (intent), dotKey, value)
    this._data.intents.set(guid, updated)
    this._notify()
    return updated
  }

  /**
   * Removes a nested property from an intent using dot-notation path.
   * Parent objects are preserved even if they become empty.
   * @param {string} guid
   * @param {string} dotKey
   * @returns {unknown | null}
   */
  removeIntentProperty (guid, dotKey) {
    const intent = this._data.intents.get(guid)
    if (!intent) return null
    const updated = this._cloneAndDeleteAtDotPath(/** @type {Record<string, unknown>} */ (intent), dotKey)
    this._data.intents.set(guid, updated)
    this._notify()
    return updated
  }

  /**
   * @param {Record<string, unknown>} obj
   * @param {string} dotKey
   * @param {unknown} value
   * @returns {Record<string, unknown>}
   */
  _cloneAndSetAtDotPath (obj, dotKey, value) {
    const keys = dotKey.split('.')
    const cloned = { ...obj }
    let cursor = cloned
    for (let i = 0; i < keys.length - 1; i++) {
      const k = /** @type {string} */ (keys[i])
      const child = cursor[k]
      const clonedChild = (child && typeof child === 'object' && !Array.isArray(child))
        ? { .../** @type {Record<string, unknown>} */ (child) }
        : {}
      cursor[k] = clonedChild
      cursor = clonedChild
    }
    const leafKey = /** @type {string} */ (keys[keys.length - 1])
    cursor[leafKey] = value
    return cloned
  }

  /**
   * @param {Record<string, unknown>} obj
   * @param {string} dotKey
   * @returns {Record<string, unknown>}
   */
  _cloneAndDeleteAtDotPath (obj, dotKey) {
    const keys = dotKey.split('.')
    const cloned = { ...obj }
    let cursor = cloned
    for (let i = 0; i < keys.length - 1; i++) {
      const k = /** @type {string} */ (keys[i])
      const child = cursor[k]
      if (!child || typeof child !== 'object' || Array.isArray(child)) return cloned
      const clonedChild = { .../** @type {Record<string, unknown>} */ (child) }
      cursor[k] = clonedChild
      cursor = clonedChild
    }
    const leafKey = /** @type {string} */ (keys[keys.length - 1])
    delete cursor[leafKey]
    return cloned
  }

  /**
   * @param {string} guid
   * @param {number} wx
   * @param {number} wz
   * @returns {unknown | null}
   */
  updateIntentPosition (guid, wx, wz) {
    const intent = this._data.intents.get(guid)
    if (!intent) return null
    const i = /** @type {Record<string, unknown>} */ (intent)
    const pos = /** @type {number[] | undefined} */ (i.position)
    const updated = { ...i, position: [wx, pos?.[1] ?? 0, wz] }
    this._data.intents.set(guid, updated)
    return updated
  }

  /**
   * @param {string} id
   * @param {number} wx
   * @param {number} wz
   * @returns {{ zoneName: string, fixtureName: string, position: [number, number, number] } | null}
   */
  updateFixturePosition (id, wx, wz) {
    const fixture = this._fixtures.get(id)
    if (!fixture) return null
    const updated = { ...fixture, position: /** @type {[number, number, number]} */ ([wx, fixture.position[1] ?? 0, wz]) }
    this._fixtures.set(id, updated)
    return updated
  }

  /**
   * @param {unknown[]} incomingIntents
   * @param {((intent: unknown) => void) | null} queueFn
   * @param {{ pruneMissing?: boolean }} [opts]
   */
  reconcileIntents (incomingIntents, queueFn, { pruneMissing = true } = {}) {
    const incoming = new Map()
    for (const intent of incomingIntents) {
      const guid = intentGuid(intent)
      if (!guid) continue
      incoming.set(guid, intent)
    }
    for (const [guid, intent] of incoming) {
      const existing = this._data.intents.get(guid)
      if (!existing || JSON.stringify(existing) !== JSON.stringify(intent)) {
        this._data.intents.set(guid, intent)
        queueFn?.(intent)
      }
    }
    if (pruneMissing) {
      for (const guid of this._data.intents.keys()) {
        if (!incoming.has(guid)) this._data.intents.delete(guid)
      }
    }
    this._notify()
  }

  // ─── Patch application ───────────────────────────────────────────────────────

  /**
   * Applies a single project key update broadcast by the hub.
   * Only called on peer controllers (not the originating sender).
   * @param {string} key
   * @param {unknown} data
   */
  applyPatch (key, data) {
    switch (key) {
      case 'scenes': {
        const rawScenes = Array.isArray(data) ? /** @type {Array<Record<string, unknown>>} */ (data) : []
        this._data.scenes = rawScenes
          .map(scene => ({
            name: String(scene.name ?? ''),
            intents: Array.isArray(scene.intents)
              ? scene.intents.map(i => String(/** @type {Record<string, unknown>} */ (i).guid ?? ''))
              : [],
          }))
          .filter(s => s.name)
        if (this._data.activeSceneName && !this._data.scenes.some(s => s.name === this._data.activeSceneName)) {
          this._data.activeSceneName = this._data.scenes[0]?.name ?? null
        }
        break
      }
      default:
        break
    }
    this._notify()
  }

  // ─── Config application ───────────────────────────────────────────────────────

  /**
   * Applies a hub config payload. Called on every `config` message.
   * Intents are NOT applied here — caller passes them to reconcileIntents separately.
   * @param {unknown} payload
   * @param {string} rendererGuid
   */
  applyConfig (payload, rendererGuid) {
    this._rendererGuid = rendererGuid

    const p = /** @type {Record<string, unknown> | null} */ (
      payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null
    )
    if (!p) return

    this._data.projectName = String(p.projectName ?? '')
    this._data.zoneToRenderer = /** @type {Record<string, string[]>} */ (p.zoneToRenderer ?? {})
    this._data.zones = Array.isArray(p.zones) ? /** @type {unknown[]} */ (p.zones) : []

    const rawScenes = Array.isArray(p.scenes) ? /** @type {Array<Record<string, unknown>>} */ (p.scenes) : []
    this._data.scenes = rawScenes
      .map(scene => ({
        name: String(scene.name ?? ''),
        intents: Array.isArray(scene.intents)
          ? scene.intents.map(i => String(/** @type {Record<string, unknown>} */ (i).guid ?? ''))
          : [],
      }))
      .filter(s => s.name)

    const hubActive = typeof p.activeSceneName === 'string' && p.activeSceneName ? p.activeSceneName : null
    if (hubActive && this._data.scenes.some(s => s.name === hubActive)) {
      this._data.activeSceneName = hubActive
    } else if (!this._data.activeSceneName && this._data.scenes.length > 0) {
      this._data.activeSceneName = this._data.scenes[0].name
    }

    // Round-trip: restore intentConfig if hub sends it back (future persistence)
    if (p.intentConfig && typeof p.intentConfig === 'object' && !Array.isArray(p.intentConfig)) {
      const saved = /** @type {Record<string, Record<string, unknown>>} */ (p.intentConfig)
      for (const [guid, config] of Object.entries(saved)) {
        if (!this._data.controller.intentConfig.has(guid)) {
          this._data.controller.intentConfig.set(guid, config)
        }
      }
    }

    this._spatial = this._computeSpatial()
    this._zoneBoxes = this._computeZoneBoxes()
    this._fixtures = this._computeFixtures()

    this._notify()
  }

  // ─── Serialization ────────────────────────────────────────────────────────────

  toJSON () {
    return {
      projectName: this._data.projectName,
      zoneToRenderer: this._data.zoneToRenderer,
      intents: [...this._data.intents.values()],
      scenes: this._data.scenes,
      activeSceneName: this._data.activeSceneName,
      controller: {
        intentConfig: Object.fromEntries(this._data.controller.intentConfig),
      },
    }
  }

  // ─── Private derivations ──────────────────────────────────────────────────────

  /** @returns {HubSpatialState | null} */
  _computeSpatial () {
    const matched = this._matchedZoneBoxes()
    if (matched.length === 0) return null
    let x1 = Infinity, y1 = Infinity, z1 = Infinity
    let x2 = -Infinity, y2 = -Infinity, z2 = -Infinity
    for (const b of matched) {
      x1 = Math.min(x1, b[0]); y1 = Math.min(y1, b[1]); z1 = Math.min(z1, b[2])
      x2 = Math.max(x2, b[3]); y2 = Math.max(y2, b[4]); z2 = Math.max(z2, b[5])
    }
    return { x1, y1, z1, x2, y2, z2 }
  }

  /** @returns {number[][]} */
  _computeZoneBoxes () {
    return this._matchedZoneBoxes()
  }

  /** @returns {number[][]} */
  _matchedZoneBoxes () {
    const rendererGuid = this._rendererGuid
    const zoneToRenderer = this._data.zoneToRenderer
    /** @type {number[][]} */
    const matched = []
    for (const z of this._data.zones) {
      if (z === null || typeof z !== 'object' || Array.isArray(z)) continue
      const zone = /** @type {Record<string, unknown>} */ (z)
      const assigned = zoneToRenderer[String(zone.name ?? '')]
      if (!Array.isArray(assigned) || !assigned.includes(rendererGuid)) continue
      const bb = zone.boundingBox
      if (!Array.isArray(bb) || bb.length < 6) continue
      matched.push(bb.map(n => Number(n)))
    }
    return matched
  }

  /** @returns {Map<string, { zoneName: string, fixtureName: string, position: [number, number, number] }>} */
  _computeFixtures () {
    const rendererGuid = this._rendererGuid
    const zoneToRenderer = this._data.zoneToRenderer
    /** @type {Map<string, { zoneName: string, fixtureName: string, position: [number, number, number] }>} */
    const fixtures = new Map()
    for (const z of this._data.zones) {
      if (z === null || typeof z !== 'object' || Array.isArray(z)) continue
      const zone = /** @type {Record<string, unknown>} */ (z)
      const zoneName = String(zone.name ?? '')
      const assigned = zoneToRenderer[zoneName]
      if (!Array.isArray(assigned) || !assigned.includes(rendererGuid)) continue
      const bb = zone.boundingBox
      const zoneFixtures = zone.fixtures
      if (!Array.isArray(bb) || bb.length < 6 || !Array.isArray(zoneFixtures)) continue
      for (const raw of zoneFixtures) {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
        const fixture = /** @type {Record<string, unknown>} */ (raw)
        const fName = String(fixture.name ?? '')
        const local = fixture.location
        if (!fName || !Array.isArray(local) || local.length < 3) continue
        fixtures.set(fixtureId(zoneName, fName), {
          zoneName,
          fixtureName: fName,
          position: /** @type {[number, number, number]} */ ([
            Number(bb[0]) + Number(local[0]),
            Number(bb[1]) + Number(local[1]),
            Number(bb[2]) + Number(local[2]),
          ]),
        })
      }
    }
    return fixtures
  }
}

export const projectGraph = new ProjectGraph()
