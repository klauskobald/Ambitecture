import { intentGuid, fixtureId } from './stores.js'
import {
  applyDotPathPatch,
  cloneAndDeleteAtDotPath,
  cloneAndSetAtDotPath,
  readAtDotPath
} from './dotPath.js'

/**
 * @typedef {object} HubSpatialState
 * @property {number} x1
 * @property {number} y1
 * @property {number} z1
 * @property {number} x2
 * @property {number} y2
 * @property {number} z2
 */

/**
 * @typedef {object} SceneIntentRef
 * @property {string} guid
 * @property {Record<string, unknown>} [overlay]
 */

class ProjectGraph {
  constructor () {
    this._rendererGuid = ''
    /** @type {Set<() => void>} */
    this._listeners = new Set()

    this._data = {
      projectName: '',
      controllerGuid: '',
      zoneToRenderer: /** @type {Record<string, string[]>} */ ({}),
      zones: /** @type {unknown[]} */ ([]),
      intents: /** @type {Map<string, unknown>} */ (new Map()),
      scenes:
        /** @type {Array<{ guid?: string, name: string, intents: SceneIntentRef[] }>} */ ([]),
      actions: /** @type {Map<string, Record<string, unknown>>} */ (new Map()),
      inputs: /** @type {Map<string, Record<string, unknown>>} */ (new Map()),
      activeSceneName: /** @type {string | null} */ (null),
      /** Hub hint: perform merge overlaps these scene intent GUIDs — show reset when non-empty. */
      runtimeOverlayGuidsInScene: /** @type {string[]} */ ([]),
      controller: {
        state: /** @type {Record<string, unknown>} */ ({}),
        intentConfig: /** @type {Map<string, Record<string, unknown>>} */ (
          new Map()
        ),
        /** Hub `controller[].intents` — refs this controller may drive; mirrors projectPatch `intents` / graph:init list. */
        intentRefs: /** @type {Array<{ guid: string }>} */ ([])
      }
    }

    /** @type {HubSpatialState | null} */
    this._spatial = null
    /** @type {number[][]} */
    this._zoneBoxes = []
    /** @type {Map<string, { guid: string, zoneName: string, fixtureName: string, position: [number, number, number] }>} */
    this._fixtures = new Map()
  }

  // ─── Subscriptions ────────────────────────────────────────────────────────────

  /** @param {() => void} fn @returns {() => void} unsubscribe */
  subscribe (fn) {
    this._listeners.add(fn)
    return () => this._listeners.delete(fn)
  }

  /** @deprecated Use {@link subscribe}; runtime deltas merge into `intents` and use the same notify path. */
  subscribeRuntime (fn) {
    return this.subscribe(fn)
  }

  _notify () {
    for (const fn of this._listeners) fn()
  }

  /**
   * Wakes graph subscribers without mutating project data. Used when
   * `systemCapabilities` arrives so UI that resolves intent descriptors can rebuild.
   */
  notifyListeners () {
    this._notify()
  }

  // ─── Derived state ────────────────────────────────────────────────────────────

  /** @returns {HubSpatialState | null} */
  getSpatial () {
    return this._spatial
  }

  /** @returns {number[][]} */
  getZoneBoxes () {
    return this._zoneBoxes
  }

  /** @returns {Map<string, { guid: string, zoneName: string, fixtureName: string, position: [number, number, number] }>} */
  getFixtures () {
    return this._fixtures
  }

  // ─── Project data ─────────────────────────────────────────────────────────────

  /** @returns {Map<string, unknown>} */
  getIntents () {
    return this._data.intents
  }

  /** @returns {string[]} */
  getScenes () {
    return this._data.scenes.map(s => s.name)
  }

  /** @param {string} sceneName @returns {string[]} guid list */
  getSceneIntents (sceneName) {
    return this.getSceneIntentRefs(sceneName).map(ref => ref.guid)
  }

  /** @param {string} sceneName @returns {SceneIntentRef[]} */
  getSceneIntentRefs (sceneName) {
    return this._data.scenes.find(s => s.name === sceneName)?.intents ?? []
  }

  /** @returns {Array<{ guid?: string, name: string, intents: SceneIntentRef[] }>} */
  getScenesData () {
    return this._data.scenes
  }

  /** @returns {Map<string, Record<string, unknown>>} */
  getActions () {
    return this._data.actions
  }

  /** @returns {Map<string, Record<string, unknown>>} */
  getInputs () {
    return this._data.inputs
  }

  /**
   * @param {string} targetType
   * @param {string} targetGuid
   * @returns {Record<string, unknown> | null}
   */
  getAssignedInput (targetType, targetGuid) {
    for (const input of this._data.inputs.values()) {
      if (inputTargets(input, targetType, targetGuid)) return input
      const actionGuid = typeof input.action === 'string' ? input.action : ''
      const action = actionGuid ? this._data.actions.get(actionGuid) : null
      if (action && actionTargets(action, targetType, targetGuid)) return input
    }
    return null
  }

  /**
   * @param {string} targetType
   * @param {string} targetGuid
   * @returns {Record<string, unknown> | null}
   */
  getAssignedAction (targetType, targetGuid) {
    for (const action of this._data.actions.values()) {
      if (actionTargets(action, targetType, targetGuid)) return action
    }
    return null
  }

  /** @param {string} sceneGuid @returns {Record<string, unknown> | null} */
  getSceneButtonInput (sceneGuid) {
    return this.getAssignedInput('scene', sceneGuid)
  }

  /** @param {string} sceneGuid @returns {Record<string, unknown> | null} */
  getSceneAction (sceneGuid) {
    return this.getAssignedAction('scene', sceneGuid)
  }

  /** @param {string} sceneName @returns {string | null} */
  getSceneGuid (sceneName) {
    return this._data.scenes.find(s => s.name === sceneName)?.guid ?? null
  }

  /** @returns {string | null} */
  getActiveSceneName () {
    return this._data.activeSceneName
  }

  /** @returns {string[]} GUIDs with hub runtime merge on this scene's intents (reset affordance). */
  getRuntimeOverlayGuidsInScene () {
    return this._data.runtimeOverlayGuidsInScene
  }

  /** @param {string} guid @returns {Record<string, unknown>} */
  getIntentConfig (guid) {
    return this._data.controller.intentConfig.get(guid) ?? {}
  }

  /** @returns {string} */
  getControllerGuid () {
    return this._data.controllerGuid
  }

  /**
   * @param {string} guid
   * @returns {Record<string, unknown> | null}
   */
  getEffectiveIntent (guid) {
    return this._getSceneEffectiveIntent(guid)
  }

  /**
   * @param {string} guid
   * @returns {Record<string, unknown> | null}
   */
  _getSceneEffectiveIntent (guid) {
    const intent = /** @type {Record<string, unknown> | undefined} */ (
      this._data.intents.get(guid)
    )
    if (!intent) return null
    const active = this._data.activeSceneName
    const ref = active ? this._findSceneIntentRef(active, guid) : null
    const overlay = ref?.overlay ?? {}
    return applyDotPathPatch(intent, overlay)
  }

  /**
   * @param {string} guid
   * @param {string} dotKey
   * @returns {unknown}
   */
  getEffectiveIntentProperty (guid, dotKey) {
    const intent = this.getEffectiveIntent(guid)
    if (!intent) return undefined
    return readAtDotPath(intent, dotKey)
  }

  /**
   * @param {string | null} sceneName
   * @param {string} guid
   * @param {string} dotKey
   * @returns {unknown}
   */
  getSceneIntentOverlayValue (sceneName, guid, dotKey) {
    if (!sceneName) return undefined
    const ref = this._findSceneIntentRef(sceneName, guid)
    if (
      !ref?.overlay ||
      !Object.prototype.hasOwnProperty.call(ref.overlay, dotKey)
    )
      return undefined
    return ref.overlay[dotKey]
  }

  /**
   * @param {string | null} sceneName
   * @param {string} guid
   * @param {string} dotKey
   * @returns {boolean}
   */
  isSceneIntentOverlayed (sceneName, guid, dotKey) {
    if (!sceneName) return false
    const ref = this._findSceneIntentRef(sceneName, guid)
    return (
      !!ref?.overlay &&
      Object.prototype.hasOwnProperty.call(ref.overlay, dotKey)
    )
  }

  /**
   * When the hub applies a runtime patch, mirror that on the replica row and strip scene
   * overlay keys the hub has superseded so getEffectiveIntent does not double-apply stale overlay.
   * @param {string} sceneName
   * @param {string} guid
   * @param {Record<string, unknown>} patch
   */
  _stripSceneOverlayKeysOverlappedByPatch (sceneName, guid, patch) {
    const ref = this._findSceneIntentRef(sceneName, guid)
    if (!ref?.overlay || typeof patch !== 'object' || Array.isArray(patch)) return
    const nextOverlay = { ...ref.overlay }
    let changed = false
    for (const k of Object.keys(patch)) {
      if (Object.prototype.hasOwnProperty.call(nextOverlay, k)) {
        delete nextOverlay[k]
        changed = true
      }
      const dotPrefix = `${k}.`
      for (const ok of [...Object.keys(nextOverlay)]) {
        if (ok.startsWith(dotPrefix)) {
          delete nextOverlay[ok]
          changed = true
        }
      }
    }
    if (!changed) return
    if (Object.keys(nextOverlay).length > 0) ref.overlay = nextOverlay
    else delete ref.overlay
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
    let intents = /** @type {SceneIntentRef[]} */ ([])
    if (cloneFromName) {
      const source = this._data.scenes.find(s => s.name === cloneFromName)
      if (source) intents = source.intents.map(ref => cloneSceneIntentRef(ref))
    }
    this._data.scenes.push({ guid: this._newGuid('scene'), name, intents })
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
  /**
   * Insert or replace intent definition in the local map (optimistic UI before hub delta).
   * @param {Record<string, unknown>} record must include string `guid`
   */
  putIntentRecord (record) {
    const guid = String(record.guid ?? '')
    if (!guid) return
    this._data.intents.set(guid, record)
    this._notify()
  }

  toggleSceneIntent (sceneName, guid) {
    const scene = this._data.scenes.find(s => s.name === sceneName)
    if (!scene) return
    const idx = scene.intents.findIndex(ref => ref.guid === guid)
    if (idx === -1) {
      scene.intents.push({ guid })
    } else {
      scene.intents.splice(idx, 1)
    }
    this._notify()
  }

  /**
   * Remove an intent ref from one scene if present (does not add). Mirrors turning an intent off in Scenes pane.
   * @param {string} sceneName
   * @param {string} guid
   * @returns {boolean} true if a ref was removed
   */
  removeIntentRefFromScene (sceneName, guid) {
    const scene = this._data.scenes.find(s => s.name === sceneName)
    if (!scene) return false
    const idx = scene.intents.findIndex(ref => ref.guid === guid)
    if (idx === -1) return false
    scene.intents.splice(idx, 1)
    this._notify()
    return true
  }

  /**
   * Append a bare `{ guid }` scene ref if not already present (does not touch other scenes).
   * @param {string} sceneName
   * @param {string} guid
   * @returns {boolean} true if a ref was added
   */
  addIntentRefToSceneIfMissing (sceneName, guid) {
    const scene = this._data.scenes.find(s => s.name === sceneName)
    if (!scene) return false
    if (scene.intents.some(ref => ref.guid === guid)) return false
    scene.intents.push({ guid })
    this._notify()
    return true
  }

  /**
   * Scenes array formatted for hub `project` save (ensures scene guids, clones overlays).
   * @returns {Array<{ guid: string, name: string, intents: SceneIntentRef[] }>}
   */
  getHubScenesWire () {
    return this._data.scenes.map(s => ({
      guid: s.guid || this._newGuid('scene'),
      name: s.name,
      intents: s.intents.map(cloneSceneIntentRef)
    }))
  }

  /**
   * Remove intent definition, all scene refs, controller ref, config, and perform-enable state (local graph only).
   * @param {string} guid
   */
  purgeIntentFromProject (guid) {
    if (!guid) return
    this._data.intents.delete(guid)
    this._data.controller.intentConfig.delete(guid)
    for (const scene of this._data.scenes) {
      scene.intents = scene.intents.filter(ref => ref.guid !== guid)
    }
    const nextRefs = this._data.controller.intentRefs.filter(
      r => r.guid !== guid
    )
    if (nextRefs.length !== this._data.controller.intentRefs.length) {
      this._data.controller.intentRefs = nextRefs
    }
    const state = this._data.controller.state
    const base =
      state && typeof state === 'object' && !Array.isArray(state)
        ? /** @type {Record<string, unknown>} */ (state)
        : /** @type {Record<string, unknown>} */ ({})
    const dotKeyPerform = `interactionPolicies.performEnabled.${guid}`
    const dotKeyQuick = `interactionPolicies.quickPanel.${guid}`
    let nextState = cloneAndDeleteAtDotPath(base, dotKeyPerform)
    nextState = cloneAndDeleteAtDotPath(nextState, dotKeyQuick)
    this._data.controller.state = nextState
    this._notify()
  }

  /**
   * @param {string} sceneName
   * @param {string} guid
   * @param {string} dotKey
   * @param {unknown} value
   * @returns {boolean}
   */
  setSceneIntentOverlay (sceneName, guid, dotKey, value) {
    const ref = this._ensureSceneIntentRef(sceneName, guid)
    if (!ref) return false
    ref.overlay = { ...(ref.overlay ?? {}), [dotKey]: cloneSceneValue(value) }
    this._notify()
    return true
  }

  /**
   * @param {string} sceneName
   * @param {string} guid
   * @param {string} dotKey
   * @returns {boolean}
   */
  removeSceneIntentOverlay (sceneName, guid, dotKey) {
    const ref = this._findSceneIntentRef(sceneName, guid)
    if (
      !ref?.overlay ||
      !Object.prototype.hasOwnProperty.call(ref.overlay, dotKey)
    )
      return false
    const nextOverlay = { ...ref.overlay }
    delete nextOverlay[dotKey]
    if (Object.keys(nextOverlay).length > 0) {
      ref.overlay = nextOverlay
    } else {
      delete ref.overlay
    }
    this._notify()
    return true
  }

  /**
   * @param {string} guid
   * @param {string} key
   * @param {unknown} value
   */
  setIntentConfig (guid, key, value) {
    const current =
      this._data.controller.intentConfig.get(guid) ?? Object.create(null)
    this._data.controller.intentConfig.set(guid, { ...current, [key]: value })
    this._notify()
  }

  /**
   * @param {string} dotKey
   * @param {unknown} value
   * @returns {{ guid: string, patch: Record<string, unknown> } | null}
   */
  patchControllerState (dotKey, value) {
    if (!this._data.controllerGuid) return null
    this._data.controller.state = cloneAndSetAtDotPath(
      this._data.controller.state,
      dotKey,
      value
    )
    this._applyControllerStateDerivedValue(dotKey, value)
    this._notify()
    return { guid: this._data.controllerGuid, patch: { [dotKey]: value } }
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
    const updated = cloneAndSetAtDotPath(
      /** @type {Record<string, unknown>} */ (intent),
      dotKey,
      value
    )
    this._data.intents.set(guid, updated)
    this._notify()
    return { guid, patch: { [dotKey]: value } }
  }

  /**
   * Live Perform / quick-panel updates: respects scene overlay like edit controls;
   * deltas are sent via `queueIntentUpdate`; hub fans out `runtime:update` into `intents`.
   * @param {string} guid
   * @param {string} dotKey
   * @param {unknown} value
   * @param {boolean} allowOverlay
   * @returns {{ guid: string, patch: Record<string, unknown> } | null}
   */
  applyPerformIntentParamUpdate (guid, dotKey, value, allowOverlay) {
    const activeScene = this.getActiveSceneName()
    const useOverlay = !!(
      allowOverlay &&
      activeScene &&
      this.isSceneIntentOverlayed(activeScene, guid, dotKey)
    )
    if (useOverlay && activeScene) {
      this.setSceneIntentOverlay(activeScene, guid, dotKey, value)
      this._notify()
      return { guid, patch: { [dotKey]: value } }
    }
    return { guid, patch: { [dotKey]: value } }
  }

  /**
   * @param {string} guid
   * @returns {string[]} stable unique dotKeys for Perform quick panel
   */
  getQuickPanelDotKeys (guid) {
    const raw = /** @type {unknown} */ (
      this.getIntentConfig(guid).quickPanelDotKeys
    )
    return normalizeQuickPanelDotKeys(raw)
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
    const updated = cloneAndDeleteAtDotPath(
      /** @type {Record<string, unknown>} */ (intent),
      dotKey
    )
    this._data.intents.set(guid, updated)
    this._notify()
    return { guid, remove: [dotKey] }
  }

  /**
   * @param {Record<string, unknown>} obj
   * @param {string} dotKey
   * @param {unknown} value
   * @returns {Record<string, unknown>}
   */
  _cloneAndSetAtDotPath (obj, dotKey, value) {
    return cloneAndSetAtDotPath(obj, dotKey, value)
  }

  /**
   * @param {Record<string, unknown>} obj
   * @param {string} dotKey
   * @returns {Record<string, unknown>}
   */
  _cloneAndDeleteAtDotPath (obj, dotKey) {
    return cloneAndDeleteAtDotPath(obj, dotKey)
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
    return { guid, patch: { position: updated.position } }
  }

  /**
   * Build a position patch from the current effective intent; does not mutate locally
   * (hub echoes runtime:update which updates `intents`).
   * @param {string} guid
   * @param {number} wx
   * @param {number} wz
   * @returns {{ guid: string, patch: { position: [number, number, number] } } | null}
   */
  updateRuntimeIntentPosition (guid, wx, wz) {
    const intent = this.getEffectiveIntent(guid)
    if (!intent) return null
    const pos = /** @type {number[] | undefined} */ (intent.position)
    const position = /** @type {[number, number, number]} */ ([
      wx,
      pos?.[1] ?? 0,
      wz
    ])
    return { guid, patch: { position } }
  }

  /** @deprecated No-op: replica has no separate runtime layer. */
  clearRuntimeIntent (_guid) {}

  /**
   * @param {string} id
   * @param {number} wx
   * @param {number} wz
   * @returns {{ guid: string, zoneName: string, fixtureName: string, position: [number, number, number] } | null}
   */
  updateFixturePosition (id, wx, wz) {
    const fixture = this._fixtures.get(id)
    if (!fixture) return null
    const updated = {
      ...fixture,
      position: /** @type {[number, number, number]} */ ([
        wx,
        fixture.position[1] ?? 0,
        wz
      ])
    }
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
   * Applies a single project key update (`projectPatch` from hub or peers).
   * @param {string} key
   * @param {unknown} data
   */
  applyPatch (key, data) {
    switch (key) {
      case 'intents': {
        const list = Array.isArray(data) ? data : []
        this._setControllerIntentRefsFromIntentsList(list)
        this.reconcileIntents(list, null, { pruneMissing: true })
        return
      }
      case 'zones': {
        this._data.zones = Array.isArray(data) ? data : []
        this._spatial = this._computeSpatial()
        this._zoneBoxes = this._computeZoneBoxes()
        this._fixtures = this._computeFixtures()
        break
      }
      case 'zoneToRenderer': {
        this._data.zoneToRenderer =
          data && typeof data === 'object' && !Array.isArray(data)
            ? /** @type {Record<string, string[]>} */ (data)
            : {}
        this._spatial = this._computeSpatial()
        this._zoneBoxes = this._computeZoneBoxes()
        break
      }
      case 'projectName': {
        if (typeof data === 'string') this._data.projectName = data
        break
      }
      case 'activeSceneName': {
        if (data === null) {
          this._data.activeSceneName = null
        } else if (typeof data === 'string' && data.length > 0) {
          if (this._data.scenes.some(s => s.name === data)) {
            this._data.activeSceneName = data
          }
        } else {
          this._data.activeSceneName = null
        }
        break
      }
      case 'scenes': {
        const rawScenes = Array.isArray(data)
          ? /** @type {Array<Record<string, unknown>>} */ (data)
          : []
        this._data.scenes = rawScenes.map(normalizeScene).filter(s => s.name)
        if (
          this._data.activeSceneName &&
          !this._data.scenes.some(s => s.name === this._data.activeSceneName)
        ) {
          this._data.activeSceneName = this._data.scenes[0]?.name ?? null
        }
        break
      }
      case 'actions': {
        this._data.actions = normalizeEntityMap(data)
        break
      }
      case 'inputs': {
        this._data.inputs = normalizeEntityMap(data)
        break
      }
      case 'runtimeOverlayGuidsInScene': {
        this._data.runtimeOverlayGuidsInScene = Array.isArray(data)
          ? /** @type {unknown[]} */ (data).filter(d => typeof d === 'string')
          : []
        break
      }
      default:
        break
    }
    this._notify()
  }

  /**
   * Applies the full graph snapshot sent only on registration/reconnect/resync.
   * @param {unknown} payload
   * @param {string} rendererGuid
   */
  applyGraphInit (payload, rendererGuid) {
    this.applyConfig(payload, rendererGuid)
    const p = /** @type {Record<string, unknown> | null} */ (
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : null
    )
    const intents = Array.isArray(p?.intents)
      ? /** @type {unknown[]} */ (p.intents)
      : []
    this._setControllerIntentRefsFromIntentsList(intents)
    this.reconcileIntents(intents, null)

    const rawOverlay = p?.runtimeOverlayGuidsInScene
    if (Array.isArray(rawOverlay)) {
      this._data.runtimeOverlayGuidsInScene = rawOverlay.filter(
        x => typeof x === 'string'
      )
    } else {
      this._data.runtimeOverlayGuidsInScene = []
    }
  }

  /**
   * @param {unknown[]} intents full intent records (as in graph:init / controller intents patch)
   */
  _setControllerIntentRefsFromIntentsList (intents) {
    /** @type {Array<{ guid: string }>} */
    const refs = []
    for (const raw of intents) {
      const g = intentGuid(raw)
      if (g) refs.push({ guid: g })
    }
    this._data.controller.intentRefs = refs
  }

  /**
   * Append `{ guid }` to this controller’s project `intents` ref list if missing (local + durable via graph:command).
   * @param {string} guid
   */
  appendControllerIntentRef (guid) {
    if (!guid) return
    if (this._data.controller.intentRefs.some(r => r.guid === guid)) return
    this._data.controller.intentRefs = [
      ...this._data.controller.intentRefs,
      { guid }
    ]
    this._notify()
  }

  /** @returns {Array<{ guid: string }>} copy for hub patch */
  getControllerIntentRefs () {
    return this._data.controller.intentRefs.map(r => ({ guid: r.guid }))
  }

  /**
   * Applies one or more GUID-addressed graph deltas from the hub.
   * @param {unknown} payload
   */
  applyGraphDelta (payload) {
    const deltas = Array.isArray(payload) ? payload : [payload]
    for (const raw of deltas) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const delta = /** @type {Record<string, unknown>} */ (raw)
      const entityType = String(delta.entityType ?? '')
      const guid = String(delta.guid ?? '')
      const op = String(delta.op ?? '')
      if (!entityType || !guid) continue
      switch (entityType) {
        case 'intent':
          this._applyIntentDelta(guid, op, delta)
          break
        case 'fixture':
          this._applyFixtureDelta(guid, op, delta)
          break
        case 'scene':
          this._applySceneDelta(guid, op, delta)
          break
        case 'action':
          this._applyEntityDelta(this._data.actions, guid, op, delta)
          break
        case 'input':
          this._applyEntityDelta(this._data.inputs, guid, op, delta)
          break
        case 'project':
          this._applyProjectDelta(delta)
          break
        case 'controller':
          this._applyControllerDelta(guid, op, delta)
          break
        default:
          break
      }
    }
    this._notify()
  }

  /**
   * Applies hub `runtime:update` deltas into the intents replica (same merge as hub; no parallel map).
   * @param {unknown} payload
   */
  applyRuntimeUpdate (payload) {
    const updates = Array.isArray(payload) ? payload : [payload]
    for (const raw of updates) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const update = /** @type {Record<string, unknown>} */ (raw)
      const entityType = String(update.entityType ?? '')
      const guid = String(update.guid ?? '')
      if (!entityType || !guid) continue
      switch (entityType) {
        case 'intent':
          this._applyRuntimeIntentDelta(guid, update)
          break
        case 'fixture':
          this._applyFixtureDelta(guid, 'patch', update)
          break
        default:
          break
      }
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
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : null
    )
    if (!p) return

    this._data.projectName = String(p.projectName ?? '')
    this._data.controllerGuid = String(
      p.controllerGuid ?? this._data.controllerGuid
    )
    this._data.zoneToRenderer = /** @type {Record<string, string[]>} */ (
      p.zoneToRenderer ?? {}
    )
    this._data.zones = Array.isArray(p.zones)
      ? /** @type {unknown[]} */ (p.zones)
      : []

    const rawScenes = Array.isArray(p.scenes)
      ? /** @type {Array<Record<string, unknown>>} */ (p.scenes)
      : []
    this._data.scenes = rawScenes.map(normalizeScene).filter(s => s.name)
    this._data.actions = normalizeEntityMap(p.actions)
    this._data.inputs = normalizeEntityMap(p.inputs)

    const hubActive =
      typeof p.activeSceneName === 'string' && p.activeSceneName
        ? p.activeSceneName
        : null
    if (hubActive && this._data.scenes.some(s => s.name === hubActive)) {
      this._data.activeSceneName = hubActive
    } else if (!this._data.activeSceneName && this._data.scenes.length > 0) {
      this._data.activeSceneName = this._data.scenes[0].name
    }

    // Round-trip: restore intentConfig if hub sends it back (future persistence)
    if (
      p.intentConfig &&
      typeof p.intentConfig === 'object' &&
      !Array.isArray(p.intentConfig)
    ) {
      const saved = /** @type {Record<string, Record<string, unknown>>} */ (
        p.intentConfig
      )
      for (const [guid, config] of Object.entries(saved)) {
        if (!this._data.controller.intentConfig.has(guid)) {
          this._data.controller.intentConfig.set(guid, config)
        }
      }
    }

    if (
      p.interactionPolicies &&
      typeof p.interactionPolicies === 'object' &&
      !Array.isArray(p.interactionPolicies)
    ) {
      this._applyInteractionPolicies(
        /** @type {Record<string, unknown>} */ (p.interactionPolicies)
      )
    }
    if (
      p.controllerState &&
      typeof p.controllerState === 'object' &&
      !Array.isArray(p.controllerState)
    ) {
      this._data.controller.state = /** @type {Record<string, unknown>} */ (
        p.controllerState
      )
      this._applyControllerStateDerivedValues(this._data.controller.state)
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
      controllerGuid: this._data.controllerGuid,
      zoneToRenderer: this._data.zoneToRenderer,
      intents: [...this._data.intents.values()],
      scenes: this._data.scenes,
      actions: [...this._data.actions.values()],
      inputs: [...this._data.inputs.values()],
      activeSceneName: this._data.activeSceneName,
      runtimeOverlayGuidsInScene: [...this._data.runtimeOverlayGuidsInScene],
      controller: {
        state: this._data.controller.state,
        intentConfig: Object.fromEntries(this._data.controller.intentConfig)
      }
    }
  }

  /**
   * @param {string} guid
   * @param {string} op
   * @param {Record<string, unknown>} delta
   */
  _applyIntentDelta (guid, op, delta) {
    if (op === 'remove') {
      this._data.intents.delete(guid)
      return
    }
    const current = /** @type {Record<string, unknown>} */ (
      this._data.intents.get(guid) ?? { guid }
    )
    const value =
      delta.value &&
      typeof delta.value === 'object' &&
      !Array.isArray(delta.value)
        ? /** @type {Record<string, unknown>} */ (delta.value)
        : current
    let next = { ...value, guid }
    const patch =
      delta.patch &&
      typeof delta.patch === 'object' &&
      !Array.isArray(delta.patch)
        ? /** @type {Record<string, unknown>} */ (delta.patch)
        : {}
    for (const [key, patchValue] of Object.entries(patch)) {
      next = cloneAndSetAtDotPath(next, key, patchValue)
    }
    const remove = Array.isArray(delta.remove) ? delta.remove.map(String) : []
    for (const key of remove) {
      next = cloneAndDeleteAtDotPath(next, key)
    }
    this._data.intents.set(guid, next)
  }

  /**
   * @param {string} guid
   * @param {Record<string, unknown>} update
   */
  _applyRuntimeIntentDelta (guid, update) {
    const patch =
      update.patch &&
      typeof update.patch === 'object' &&
      !Array.isArray(update.patch)
        ? /** @type {Record<string, unknown>} */ (update.patch)
        : {}
    const remove = Array.isArray(update.remove) ? update.remove.map(String) : []
    const activeScene = this._data.activeSceneName
    if (activeScene && Object.keys(patch).length > 0) {
      this._stripSceneOverlayKeysOverlappedByPatch(activeScene, guid, patch)
    }
    const current =
      this._getSceneEffectiveIntent(guid) ??
      /** @type {Record<string, unknown>} */ (this._data.intents.get(guid)) ??
      { guid }
    const value =
      update.value &&
      typeof update.value === 'object' &&
      !Array.isArray(update.value)
        ? /** @type {Record<string, unknown>} */ (update.value)
        : current
    const next = applyDotPathPatch({ ...value, guid }, patch, remove)
    this._data.intents.set(guid, next)
  }

  /**
   * @param {string} guid
   * @param {string} op
   * @param {Record<string, unknown>} delta
   */
  _applyFixtureDelta (guid, op, delta) {
    if (op === 'remove') return
    const value =
      delta.value &&
      typeof delta.value === 'object' &&
      !Array.isArray(delta.value)
        ? /** @type {Record<string, unknown>} */ (delta.value)
        : null
    if (value) {
      const zoneName = String(value.zoneName ?? '')
      const targetZone = this._data.zones.find(zone => {
        if (!zone || typeof zone !== 'object' || Array.isArray(zone))
          return false
        const z = /** @type {Record<string, unknown>} */ (zone)
        return (
          String(z.name ?? '') === zoneName ||
          String(z.guid ?? '') === String(value.zoneGuid ?? '')
        )
      })
      if (
        targetZone &&
        typeof targetZone === 'object' &&
        !Array.isArray(targetZone)
      ) {
        for (const zone of this._data.zones) {
          if (!zone || typeof zone !== 'object' || Array.isArray(zone)) continue
          const fixtures = /** @type {Record<string, unknown>} */ (zone)
            .fixtures
          if (!Array.isArray(fixtures)) continue
          const idx = fixtures.findIndex(
            fixture =>
              fixture &&
              typeof fixture === 'object' &&
              !Array.isArray(fixture) &&
              String(
                /** @type {Record<string, unknown>} */ (fixture).guid ?? ''
              ) === guid
          )
          if (idx >= 0) fixtures.splice(idx, 1)
        }
        const targetFixtures = /** @type {Record<string, unknown>} */ (
          targetZone
        ).fixtures
        if (Array.isArray(targetFixtures)) {
          const fixtureCopy = { ...value }
          delete fixtureCopy.zoneGuid
          delete fixtureCopy.zoneName
          targetFixtures.push(fixtureCopy)
        }
        this._fixtures = this._computeFixtures()
        return
      }
    }
    const patch =
      delta.patch &&
      typeof delta.patch === 'object' &&
      !Array.isArray(delta.patch)
        ? /** @type {Record<string, unknown>} */ (delta.patch)
        : {}
    const position = patch.position
    if (!Array.isArray(position) || position.length < 3) return
    for (const zone of this._data.zones) {
      if (!zone || typeof zone !== 'object' || Array.isArray(zone)) continue
      const z = /** @type {Record<string, unknown>} */ (zone)
      const bb = z.boundingBox
      const fixtures = z.fixtures
      if (!Array.isArray(bb) || bb.length < 6 || !Array.isArray(fixtures))
        continue
      for (const fixture of fixtures) {
        if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture))
          continue
        const f = /** @type {Record<string, unknown>} */ (fixture)
        if (String(f.guid ?? '') !== guid) continue
        f.location = [
          Number(position[0]) - Number(bb[0]),
          Number(position[1]) - Number(bb[1]),
          Number(position[2]) - Number(bb[2])
        ]
      }
    }
    this._fixtures = this._computeFixtures()
  }

  /**
   * @param {string} guid
   * @param {string} op
   * @param {Record<string, unknown>} delta
   */
  _applySceneDelta (guid, op, delta) {
    const idx = this._data.scenes.findIndex(s => s.guid === guid)
    if (op === 'remove') {
      if (idx >= 0) this._data.scenes.splice(idx, 1)
      return
    }
    const value =
      delta.value &&
      typeof delta.value === 'object' &&
      !Array.isArray(delta.value)
        ? /** @type {Record<string, unknown>} */ (delta.value)
        : {}
    const scene = normalizeScene({
      ...value,
      guid,
      name: String(value.name ?? this._data.scenes[idx]?.name ?? ''),
      intents: Array.isArray(value.intents)
        ? value.intents
        : this._data.scenes[idx]?.intents ?? []
    })
    if (idx >= 0) {
      this._data.scenes[idx] = scene
    } else if (scene.name) {
      this._data.scenes.push(scene)
    }
  }

  /**
   * @param {Map<string, Record<string, unknown>>} target
   * @param {string} guid
   * @param {string} op
   * @param {Record<string, unknown>} delta
   */
  _applyEntityDelta (target, guid, op, delta) {
    if (op === 'remove') {
      target.delete(guid)
      return
    }
    const current = target.get(guid) ?? { guid }
    const value =
      delta.value &&
      typeof delta.value === 'object' &&
      !Array.isArray(delta.value)
        ? /** @type {Record<string, unknown>} */ (delta.value)
        : current
    let next = { ...value, guid }
    const patch =
      delta.patch &&
      typeof delta.patch === 'object' &&
      !Array.isArray(delta.patch)
        ? /** @type {Record<string, unknown>} */ (delta.patch)
        : {}
    for (const [key, patchValue] of Object.entries(patch)) {
      next = cloneAndSetAtDotPath(next, key, patchValue)
    }
    const remove = Array.isArray(delta.remove) ? delta.remove.map(String) : []
    for (const key of remove) {
      next = cloneAndDeleteAtDotPath(next, key)
    }
    target.set(guid, next)
  }

  /** @param {Record<string, unknown>} delta */
  _applyProjectDelta (delta) {
    const patch =
      delta.patch &&
      typeof delta.patch === 'object' &&
      !Array.isArray(delta.patch)
        ? /** @type {Record<string, unknown>} */ (delta.patch)
        : {}
    if (typeof patch.activeSceneName === 'string') {
      this._data.activeSceneName = patch.activeSceneName
    }
    const rawOverlay = patch.runtimeOverlayGuidsInScene
    if (Array.isArray(rawOverlay)) {
      this._data.runtimeOverlayGuidsInScene = rawOverlay.filter(
        x => typeof x === 'string'
      )
    }
  }

  /**
   * @param {string} guid
   * @param {string} op
   * @param {Record<string, unknown>} delta
   */
  _applyControllerDelta (guid, op, delta) {
    if (guid !== this._data.controllerGuid || op === 'remove') return
    const patch =
      delta.patch &&
      typeof delta.patch === 'object' &&
      !Array.isArray(delta.patch)
        ? /** @type {Record<string, unknown>} */ (delta.patch)
        : {}
    const value =
      delta.value &&
      typeof delta.value === 'object' &&
      !Array.isArray(delta.value)
        ? /** @type {Record<string, unknown>} */ (delta.value)
        : null
    if (value) {
      this._data.controller.state = { ...this._data.controller.state, ...value }
      this._applyControllerStateDerivedValues(this._data.controller.state)
    }
    for (const [key, patchValue] of Object.entries(patch)) {
      if (key === 'intents' && Array.isArray(patchValue)) {
        this._data.controller.intentRefs = patchValue
          .map(item => {
            if (
              item &&
              typeof item === 'object' &&
              !Array.isArray(item) &&
              typeof (/** @type {Record<string, unknown>} */ (item).guid) ===
                'string'
            ) {
              return {
                guid: String(/** @type {Record<string, unknown>} */ (item).guid)
              }
            }
            return null
          })
          .filter(/** @returns {v is { guid: string }} */ v => v !== null)
        continue
      }
      this._data.controller.state = cloneAndSetAtDotPath(
        this._data.controller.state,
        key,
        patchValue
      )
      this._applyControllerStateDerivedValue(key, patchValue)
    }
  }

  /** @param {Record<string, unknown>} state */
  _applyControllerStateDerivedValues (state) {
    const interactionPolicies = state.interactionPolicies
    if (
      interactionPolicies &&
      typeof interactionPolicies === 'object' &&
      !Array.isArray(interactionPolicies)
    ) {
      this._applyInteractionPolicies(
        /** @type {Record<string, unknown>} */ (interactionPolicies)
      )
    }
  }

  /**
   * @param {string} dotKey
   * @param {unknown} value
   */
  _applyControllerStateDerivedValue (dotKey, value) {
    const performPrefix = 'interactionPolicies.performEnabled.'
    const quickPrefix = 'interactionPolicies.quickPanel.'
    if (dotKey.startsWith(performPrefix)) {
      const intentGuid = dotKey.slice(performPrefix.length)
      if (!intentGuid) return
      const current =
        this._data.controller.intentConfig.get(intentGuid) ??
        Object.create(null)
      this._data.controller.intentConfig.set(intentGuid, {
        ...current,
        performEnabled: Boolean(value)
      })
      return
    }
    if (dotKey.startsWith(quickPrefix)) {
      const intentGuid = dotKey.slice(quickPrefix.length)
      if (!intentGuid) return
      const current =
        this._data.controller.intentConfig.get(intentGuid) ??
        Object.create(null)
      this._data.controller.intentConfig.set(intentGuid, {
        ...current,
        quickPanelDotKeys: normalizeQuickPanelDotKeys(value)
      })
    }
  }

  /** @param {Record<string, unknown>} policies */
  _applyInteractionPolicies (policies) {
    const performEnabled = policies.performEnabled
    if (
      performEnabled &&
      typeof performEnabled === 'object' &&
      !Array.isArray(performEnabled)
    ) {
      for (const [guid, enabled] of Object.entries(
        /** @type {Record<string, unknown>} */ (performEnabled)
      )) {
        this.setIntentConfig(guid, 'performEnabled', Boolean(enabled))
      }
    }
    const quickPanel = policies.quickPanel
    if (
      quickPanel &&
      typeof quickPanel === 'object' &&
      !Array.isArray(quickPanel)
    ) {
      for (const [guid, keys] of Object.entries(
        /** @type {Record<string, unknown>} */ (quickPanel)
      )) {
        this.setIntentConfig(
          guid,
          'quickPanelDotKeys',
          normalizeQuickPanelDotKeys(keys)
        )
      }
    }
  }

  // ─── Private derivations ──────────────────────────────────────────────────────

  /** @returns {HubSpatialState | null} */
  _computeSpatial () {
    const matched = this._matchedZoneBoxes()
    if (matched.length === 0) return null
    let x1 = Infinity,
      y1 = Infinity,
      z1 = Infinity
    let x2 = -Infinity,
      y2 = -Infinity,
      z2 = -Infinity
    for (const b of matched) {
      x1 = Math.min(x1, b[0])
      y1 = Math.min(y1, b[1])
      z1 = Math.min(z1, b[2])
      x2 = Math.max(x2, b[3])
      y2 = Math.max(y2, b[4])
      z2 = Math.max(z2, b[5])
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

  /** @returns {Map<string, { guid: string, zoneName: string, fixtureName: string, position: [number, number, number] }>} */
  _computeFixtures () {
    const rendererGuid = this._rendererGuid
    const zoneToRenderer = this._data.zoneToRenderer
    /** @type {Map<string, { guid: string, zoneName: string, fixtureName: string, position: [number, number, number] }>} */
    const fixtures = new Map()
    for (const z of this._data.zones) {
      if (z === null || typeof z !== 'object' || Array.isArray(z)) continue
      const zone = /** @type {Record<string, unknown>} */ (z)
      const zoneName = String(zone.name ?? '')
      const assigned = zoneToRenderer[zoneName]
      if (!Array.isArray(assigned) || !assigned.includes(rendererGuid)) continue
      const bb = zone.boundingBox
      const zoneFixtures = zone.fixtures
      if (!Array.isArray(bb) || bb.length < 6 || !Array.isArray(zoneFixtures))
        continue
      for (const raw of zoneFixtures) {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
          continue
        const fixture = /** @type {Record<string, unknown>} */ (raw)
        const fName = String(fixture.name ?? '')
        const guid = String(fixture.guid ?? fixtureId(zoneName, fName))
        const local = fixture.location
        if (!fName || !Array.isArray(local) || local.length < 3) continue
        fixtures.set(fixtureId(zoneName, fName), {
          guid,
          zoneName,
          fixtureName: fName,
          position: /** @type {[number, number, number]} */ ([
            Number(bb[0]) + Number(local[0]),
            Number(bb[1]) + Number(local[1]),
            Number(bb[2]) + Number(local[2])
          ])
        })
      }
    }
    return fixtures
  }

  /**
   * @param {string} sceneName
   * @param {string} guid
   * @returns {SceneIntentRef | null}
   */
  _findSceneIntentRef (sceneName, guid) {
    const scene = this._data.scenes.find(s => s.name === sceneName)
    return scene?.intents.find(ref => ref.guid === guid) ?? null
  }

  /**
   * @param {string} sceneName
   * @param {string} guid
   * @returns {SceneIntentRef | null}
   */
  _ensureSceneIntentRef (sceneName, guid) {
    const scene = this._data.scenes.find(s => s.name === sceneName)
    if (!scene) return null
    let ref = scene.intents.find(item => item.guid === guid)
    if (!ref) {
      ref = { guid }
      scene.intents.push(ref)
    }
    return ref
  }

  /** @param {string} prefix */
  _newGuid (prefix) {
    const cryptoApi = globalThis.crypto
    if (cryptoApi?.randomUUID) return `${prefix}-${cryptoApi.randomUUID()}`
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

/**
 * @param {unknown} raw
 * @returns {SceneIntentRef}
 */
function normalizeSceneIntentRef (raw) {
  if (typeof raw === 'string') return { guid: raw }
  const record =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? /** @type {Record<string, unknown>} */ (raw)
      : {}
  const guid = String(record.guid ?? '')
  const overlay =
    record.overlay &&
    typeof record.overlay === 'object' &&
    !Array.isArray(record.overlay)
      ? cloneOverlay(/** @type {Record<string, unknown>} */ (record.overlay))
      : undefined
  return overlay ? { guid, overlay } : { guid }
}

/**
 * @param {SceneIntentRef} ref
 * @returns {SceneIntentRef}
 */
function cloneSceneIntentRef (ref) {
  return ref.overlay
    ? { guid: ref.guid, overlay: cloneOverlay(ref.overlay) }
    : { guid: ref.guid }
}

/**
 * @param {Record<string, unknown>} overlay
 * @returns {Record<string, unknown>}
 */
function cloneOverlay (overlay) {
  return Object.fromEntries(
    Object.entries(overlay).map(([key, value]) => [key, cloneSceneValue(value)])
  )
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function cloneSceneValue (value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

/**
 * @param {Record<string, unknown>} scene
 * @returns {{ guid: string, name: string, intents: SceneIntentRef[] }}
 */
function normalizeScene (scene) {
  return {
    guid: String(scene.guid ?? ''),
    name: String(scene.name ?? ''),
    intents: Array.isArray(scene.intents)
      ? scene.intents.map(normalizeSceneIntentRef).filter(ref => ref.guid)
      : []
  }
}

/**
 * @param {unknown} raw
 * @returns {Map<string, Record<string, unknown>>}
 */
function normalizeEntityMap (raw) {
  const map = /** @type {Map<string, Record<string, unknown>>} */ (new Map())
  const list = Array.isArray(raw) ? raw : []
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = /** @type {Record<string, unknown>} */ (item)
    const guid = String(record.guid ?? '')
    if (!guid) continue
    map.set(guid, { ...record, guid })
  }
  return map
}

/**
 * @param {Record<string, unknown>} action
 * @param {string} targetType
 * @param {string} targetGuid
 * @returns {boolean}
 */
function actionTargets (action, targetType, targetGuid) {
  const execute = action.execute
  if (!Array.isArray(execute)) return false
  return execute.some(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const record = /** @type {Record<string, unknown>} */ (item)
    return record.type === targetType && record.guid === targetGuid
  })
}

/**
 * @param {Record<string, unknown>} input
 * @param {string} targetType
 * @param {string} targetGuid
 * @returns {boolean}
 */
function inputTargets (input, targetType, targetGuid) {
  const target = input.target
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    const t = /** @type {Record<string, unknown>} */ (target)
    if (t.type === targetType && t.guid === targetGuid) return true
  }
  if (targetType === 'scene') {
    const context = typeof input.context === 'string' ? input.context : ''
    if (context && context === targetGuid) return true
  }
  return false
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeQuickPanelDotKeys (value) {
  if (!Array.isArray(value)) return []
  const out = []
  const seen = new Set()
  for (const item of value) {
    const s = typeof item === 'string' ? item : ''
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

export const projectGraph = new ProjectGraph()
