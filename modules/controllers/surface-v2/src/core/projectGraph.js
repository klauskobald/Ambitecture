import { intentGuid, fixtureId } from './stores.js'
import { clampPulseSetupSpeed } from './pulseFormat.js'
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

/**
 * Change topics emitted by {@link ProjectGraph._notify}. Subscribers can opt into a subset
 * so e.g. ScenesPane is not woken by per-frame `intents:runtime` patches from animation.
 *
 * - `scenes` — scene list, scene-intent refs, scene overlays, active scene name
 * - `intents:def` — intent definition rows (graph:init, config, graph:delta entity intent, reconcileIntents)
 * - `intents:runtime` — runtime intent patches (`runtime:update` from animation, perform-drag, …)
 * - `fixtures` — `_fixtures` map and zone-derived data
 * - `actions` / `inputs` / `animations` — entity maps
 * - `controller` — controller state, intentRefs, intentConfig, interaction policies
 * - `runtimeOverlayHints` — hub hint `runtimeOverlayGuidsInScene`
 * - `project` — projectName, controllerGuid, zones, zoneToRenderer, capabilities
 *
 * @typedef {(
 *   'scenes' |
 *   'intents:def' |
 *   'intents:runtime' |
 *   'fixtures' |
 *   'actions' |
 *   'inputs' |
 *   'animations' |
 *   'controller' |
 *   'discovery' (hub plugin UI advertisements; no graph mutation) |
 *   'runtimeOverlayHints' |
 *   'project'
 * )} ProjectGraphTopic
 */

/**
 * @param {Record<string, unknown>} input
 * @returns {string[]}
 */
export function inputActionGuidList (input) {
  const a = input.actions
  if (!Array.isArray(a)) return []
  return a.filter(g => typeof g === 'string' && g.length > 0)
}

class ProjectGraph {
  constructor () {
    this._rendererGuid = ''
    /**
     * Each listener has an optional topic filter (`null` = wake on any change).
     * @type {Set<{ topics: Set<string> | null, fn: (topics: Set<string>) => void }>}
     */
    this._listeners = new Set()
    /**
     * Topic accumulator for the current public mutation. `null` means we are not inside
     * a batch — `_notify` then fires immediately. {@link _withBatch} sets this to a Set
     * so per-delta topic notifications coalesce into one outer fire.
     * @type {Set<string> | null}
     */
    this._pendingTopics = null
    /**
     * Guids whose row in `_data.intents` last matched hub snapshot (`projectPatch` / graph intent / runtime echo).
     * For these, `getEffectiveIntent` must not re-apply `scenes[].overlay` — that YAML is stale vs merged hub rows.
     */
    this._trustHubReconciledIntentRow = new Set()
    /**
     * `${sceneName}|${guid}|${dotKey}` tuples whose scene overlay must survive runtime:update echoes.
     * Held while an edit control streams a runtime preview for an overlayed key — the hub echoes the
     * patch back and would otherwise strip the matching overlay key in {@link _stripSceneOverlayKeysOverlappedByPatch}.
     * @type {Set<string>}
     */
    this._pinnedOverlayEditKeys = new Set()

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
      pulses: /** @type {{ setups: unknown[], buckets: Array<Record<string, unknown>> }} */ ({
        setups: [],
        buckets: []
      }),
      /** Hub `entities.animation` from `graph:init` + `graph:delta` entityType `animation`. */
      animations: /** @type {Map<string, Record<string, unknown>>} */ (
        new Map()
      ),
      activeSceneGuid: /** @type {string | null} */ (null),
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

  /**
   * Subscribe to graph change notifications.
   *
   * Two call shapes are supported (legacy single-arg form is preserved so panes can
   * migrate incrementally):
   *
   *   subscribe(fn)              // wake on every change (back-compat)
   *   subscribe(topics, fn)      // wake only when one of the listed topics changed;
   *                              // pass `null` for "all topics".
   *
   * The callback receives the Set of topics that fired. Legacy callbacks ignore it.
   *
   * @param {ProjectGraphTopic[] | null | ((topics: Set<string>) => void)} topicsOrFn
   * @param {((topics: Set<string>) => void)} [maybeFn]
   * @returns {() => void} unsubscribe
   */
  subscribe (topicsOrFn, maybeFn) {
    const fn = typeof topicsOrFn === 'function' ? topicsOrFn : maybeFn
    if (typeof fn !== 'function') {
      throw new TypeError('projectGraph.subscribe requires a function')
    }
    const topics =
      topicsOrFn === null || typeof topicsOrFn === 'function'
        ? null
        : new Set(topicsOrFn)
    const entry = { topics, fn }
    this._listeners.add(entry)
    return () => this._listeners.delete(entry)
  }

  /** @deprecated Use {@link subscribe}; runtime deltas merge into `intents` and use the same notify path. */
  subscribeRuntime (fn) {
    return this.subscribe(fn)
  }

  /**
   * Notify subscribers that one or more topics changed. Inside {@link _withBatch}
   * topics accumulate into a Set and a single outer notify fires when the batch ends.
   *
   * @param {ProjectGraphTopic | ProjectGraphTopic[] | null | undefined} topic
   */
  _notify (topic) {
    const pending = this._pendingTopics
    if (pending !== null) {
      addTopicsToSet(pending, topic)
      return
    }
    const set = new Set()
    addTopicsToSet(set, topic)
    this._fireListeners(set)
  }

  /**
   * Run `mutator` then fire one notify with the union of topics emitted during it.
   * Used by `applyConfig`, `applyGraphInit`, `applyGraphDelta`, `applyRuntimeUpdate`,
   * `applyPatch`, etc. — anywhere multiple internal mutations should look like one
   * change to subscribers.
   * @param {() => void} mutator
   * @param {ProjectGraphTopic | ProjectGraphTopic[]} [extraTopics] always-on topics for the batch
   */
  _withBatch (mutator, extraTopics) {
    const previous = this._pendingTopics
    const set = previous ?? new Set()
    if (extraTopics !== undefined) addTopicsToSet(set, extraTopics)
    this._pendingTopics = set
    try {
      mutator()
    } finally {
      this._pendingTopics = previous
    }
    if (previous === null) this._fireListeners(set)
  }

  /** @param {Set<string>} topics */
  _fireListeners (topics) {
    if (this._listeners.size === 0) return
    const snapshot = [...this._listeners]
    for (const entry of snapshot) {
      const filter = entry.topics
      if (filter !== null) {
        let intersects = false
        for (const t of topics) {
          if (filter.has(t)) {
            intersects = true
            break
          }
        }
        if (!intersects) continue
      }
      entry.fn(topics)
    }
  }

  /**
   * Wakes graph subscribers without mutating project data. Used when
   * `systemCapabilities` arrives so UI that resolves intent / animation / input /
   * scene descriptors can rebuild from the new capability map.
   */
  notifyListeners () {
    this._notify([
      'project',
      'intents:def',
      'animations',
      'actions',
      'inputs',
      'scenes',
      'controller'
    ])
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

  getPulses () {
    return this._data.pulses
  }

  /** @returns {Iterable<Record<string, unknown>>} */
  getPulseBuckets () {
    return this._data.pulses.buckets
  }

  /** @returns {Record<string, unknown>[]} */
  getPulseSetups () {
    return this._data.pulses.setups
  }

  /**
   * @returns {{ enabled: boolean, restart: 'never' | 'bar' | 'onset', lerp: number }}
   */
  getPulseSync () {
    const raw = this._data.pulses.sync
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { enabled: false, restart: 'never', lerp: 0.35 }
    }
    const enabled = raw.enabled === true
    const restartRaw = raw.restart
    const restart =
      restartRaw === 'bar' || restartRaw === 'onset' ? restartRaw : 'never'
    const lerp =
      typeof raw.lerp === 'number' && Number.isFinite(raw.lerp) ? raw.lerp : 0.35
    return { enabled, restart, lerp: Math.min(1, Math.max(0.1, lerp)) }
  }

  /**
   * @param {string} guid
   * @returns {Record<string, unknown> | undefined}
   */
  getPulseSetup (guid) {
    if (!guid) return undefined
    return this._data.pulses.setups.find(
      s => typeof s.guid === 'string' && s.guid === guid
    )
  }

  /**
   * @param {Record<string, unknown>} bucket
   * @param {string} animationGuid
   * @returns {boolean}
   */
  bucketLinksAnimation (bucket, animationGuid) {
    const actions = this._data.actions
    const guids = Array.isArray(bucket.actions) ? bucket.actions : []
    for (const ag of guids) {
      if (typeof ag !== 'string') continue
      const action = actions.get(ag)
      if (actionExecuteTargetsAnimation(action, animationGuid)) return true
    }
    return false
  }

  /**
   * @param {string} bucketGuid
   * @param {string} animationGuid
   * @returns {string}
   */
  getPulseBucketAnimationActionGuid (bucketGuid, animationGuid) {
    if (!bucketGuid || !animationGuid) return ''
    const bucket = this._data.pulses.buckets.find(
      b => typeof b.guid === 'string' && b.guid === bucketGuid
    )
    if (!bucket) return ''
    const guids = Array.isArray(bucket.actions) ? bucket.actions : []
    for (const ag of guids) {
      if (typeof ag !== 'string') continue
      const action = this._data.actions.get(ag)
      if (actionExecuteTargetsAnimation(action, animationGuid)) return ag
    }
    return ''
  }

  /**
   * @param {string} animationGuid
   * @returns {Record<string, unknown>[]}
   */
  getBucketsLinkedToAnimation (animationGuid) {
    if (!animationGuid) return []
    return this._data.pulses.buckets.filter(b =>
      this.bucketLinksAnimation(b, animationGuid)
    )
  }

  /**
   * @param {Record<string, unknown>} bucket
   * @param {string} sceneGuid
   * @returns {boolean}
   */
  bucketLinksScene (bucket, sceneGuid) {
    const actions = this._data.actions
    const guids = Array.isArray(bucket.actions) ? bucket.actions : []
    for (const ag of guids) {
      if (typeof ag !== 'string') continue
      const action = actions.get(ag)
      if (actionExecuteTargetsScene(action, sceneGuid)) return true
    }
    return false
  }

  /**
   * @param {string} sceneGuid
   * @returns {Record<string, unknown>[]}
   */
  getBucketsLinkedToScene (sceneGuid) {
    if (!sceneGuid) return []
    return this._data.pulses.buckets.filter(b =>
      this.bucketLinksScene(b, sceneGuid)
    )
  }

  /**
   * Other scene actions already in a bucket (not animation actions).
   *
   * @param {string} bucketGuid
   * @param {string} exceptSceneGuid scene being linked — excluded from the list
   * @returns {string[]} display names of scenes that would be removed
   */
  getOtherSceneDisplayNamesInBucket (bucketGuid, exceptSceneGuid) {
    const bucket = this._data.pulses.buckets.find(
      b => typeof b.guid === 'string' && b.guid === bucketGuid
    )
    if (!bucket) return []
    const names = []
    const guids = Array.isArray(bucket.actions) ? bucket.actions : []
    for (const ag of guids) {
      if (typeof ag !== 'string') continue
      const action = this._data.actions.get(ag)
      const raw =
        action && typeof action === 'object' && !Array.isArray(action)
          ? /** @type {{ execute?: unknown }} */ (action).execute
          : undefined
      const ex =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? /** @type {Record<string, unknown>} */ (raw)
          : null
      if (!ex || ex.type !== 'scene') continue
      const sg = typeof ex.guid === 'string' ? ex.guid : ''
      if (!sg || sg === exceptSceneGuid) continue
      const scene = this._data.scenes.find(s => s.guid === sg)
      const label =
        typeof scene?.name === 'string' && scene.name.length > 0
          ? scene.name
          : sg
      names.push(label)
    }
    return names
  }

  /** @returns {Map<string, Record<string, unknown>>} */
  getInputs () {
    return this._data.inputs
  }

  /** @returns {Map<string, Record<string, unknown>>} */
  getAnimations () {
    return this._data.animations
  }

  /**
   * Animations that share a runner `action` guid (companion row from hub) — safe to `action:trigger`.
   * @returns {Array<{ guid: string, name: string, class: string, targetIntents: string[] }>}
   */
  getPlayableAnimationsList () {
    /** @type {Array<{ guid: string, name: string, class: string, targetIntents: string[] }>} */
    const out = []
    for (const [guid, row] of this._data.animations) {
      const action = this._data.actions.get(guid)
      if (!action || !companionAnimationRunnerAction(action, guid)) continue
      const name =
        typeof row.name === 'string' && row.name.length > 0 ? row.name : guid
      const cls = typeof row.class === 'string' ? row.class : ''
      const targetIntents = normalizePlayableAnimationTargetIntents(row)
      out.push({ guid, name, class: cls, targetIntents })
    }
    out.sort((a, b) => a.name.localeCompare(b.name))
    return out
  }

  /**
   * @param {Record<string, Record<string, unknown>>} entityMap
   *    `entities.animation` from hub — keyed by animation guid.
   */
  _mergeAnimationsFromEntityMap (entityMap) {
    for (const [key, raw] of Object.entries(entityMap)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const record = /** @type {Record<string, unknown>} */ (raw)
      const guid = String(record.guid ?? key ?? '')
      if (!guid) continue
      this._data.animations.set(guid, { ...record, guid })
    }
  }

  /**
   * @param {string} targetType
   * @param {string} targetGuid
   * @returns {Record<string, unknown> | null}
   */
  getAssignedInput (targetType, targetGuid) {
    for (const input of this._data.inputs.values()) {
      for (const ag of inputActionGuidList(input)) {
        const action = this._data.actions.get(ag)
        if (action && actionTargets(action, targetType, targetGuid))
          return input
      }
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
    const guid = this._data.activeSceneGuid
    if (!guid) return null
    return this._data.scenes.find(s => s.guid === guid)?.name ?? null
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
    if (this._trustHubReconciledIntentRow.has(guid)) {
      return intent
    }
    const active = this.getActiveSceneName()
    const ref = active ? this._findSceneIntentRef(active, guid) : null
    const overlay = ref?.overlay ?? {}
    return applyDotPathPatch({ ...intent }, overlay)
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
   * overlay keys the hub has superseded so they are not double-applied alongside the merged row.
   * (When the map row is hub-reconciled, {@link _trustHubReconciledIntentRow} skips re-merging YAML overlay in {@link _getSceneEffectiveIntent}.)
   * @param {string} sceneName
   * @param {string} guid
   * @param {Record<string, unknown>} patch
   */
  _stripSceneOverlayKeysOverlappedByPatch (sceneName, guid, patch) {
    const ref = this._findSceneIntentRef(sceneName, guid)
    if (!ref?.overlay || typeof patch !== 'object' || Array.isArray(patch))
      return
    const nextOverlay = { ...ref.overlay }
    let changed = false
    for (const k of Object.keys(patch)) {
      if (this._pinnedOverlayEditKeys.has(`${sceneName}|${guid}|${k}`)) continue
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

  /**
   * Hold a scene overlay key against runtime:update echo stripping while an edit control is
   * streaming a live preview for it. Must be paired with {@link unpinOverlayForEdit} on drag end.
   * @param {string} sceneName
   * @param {string} guid
   * @param {string} dotKey
   */
  pinOverlayForEdit (sceneName, guid, dotKey) {
    this._pinnedOverlayEditKeys.add(`${sceneName}|${guid}|${dotKey}`)
  }

  /**
   * @param {string} sceneName
   * @param {string} guid
   * @param {string} dotKey
   */
  unpinOverlayForEdit (sceneName, guid, dotKey) {
    this._pinnedOverlayEditKeys.delete(`${sceneName}|${guid}|${dotKey}`)
  }

  // ─── Mutations ────────────────────────────────────────────────────────────────

  /** @param {string} name */
  setActiveScene (name) {
    this._data.activeSceneGuid = this.getSceneGuid(name)
    this._notify('scenes')
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
    this._data.activeSceneGuid = this.getSceneGuid(name)
    this._notify('scenes')
    return true
  }

  /** @param {string} name */
  removeScene (name) {
    const idx = this._data.scenes.findIndex(s => s.name === name)
    if (idx === -1) return
    this._data.scenes.splice(idx, 1)
    if (this.getActiveSceneName() === name) {
      this._data.activeSceneGuid = this._data.scenes[0]?.guid ?? null
    }
    this._notify('scenes')
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
    this._trustHubReconciledIntentRow.delete(guid)
    this._data.intents.set(guid, record)
    this._notify('intents:def')
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
    this._notify('scenes')
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
    this._notify('scenes')
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
    this._notify('scenes')
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
    this._trustHubReconciledIntentRow.delete(guid)
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
    this._notify(['intents:def', 'scenes', 'controller'])
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
    this._trustHubReconciledIntentRow.delete(guid)
    ref.overlay = { ...(ref.overlay ?? {}), [dotKey]: cloneSceneValue(value) }
    this._notify('scenes')
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
    this._trustHubReconciledIntentRow.delete(guid)
    const nextOverlay = { ...ref.overlay }
    delete nextOverlay[dotKey]
    if (Object.keys(nextOverlay).length > 0) {
      ref.overlay = nextOverlay
    } else {
      delete ref.overlay
    }
    this._notify('scenes')
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
    this._notify('controller')
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
    this._notify('controller')
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
    this._trustHubReconciledIntentRow.delete(guid)
    const updated = cloneAndSetAtDotPath(
      /** @type {Record<string, unknown>} */ (intent),
      dotKey,
      value
    )
    this._data.intents.set(guid, updated)
    this._notify('intents:def')
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
      // setSceneIntentOverlay already emits 'scenes'; no extra notify needed.
      this.setSceneIntentOverlay(activeScene, guid, dotKey, value)
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
    this._trustHubReconciledIntentRow.delete(guid)
    const updated = cloneAndDeleteAtDotPath(
      /** @type {Record<string, unknown>} */ (intent),
      dotKey
    )
    this._data.intents.set(guid, updated)
    this._notify('intents:def')
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
    this._trustHubReconciledIntentRow.delete(guid)
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
      for (const guid of [...this._data.intents.keys()]) {
        if (!incoming.has(guid)) {
          this._data.intents.delete(guid)
          this._trustHubReconciledIntentRow.delete(guid)
        }
      }
    }
    // Don't mark intents from reconcile as trusted, since they may not have scene overlays applied yet.
    // Only runtime updates (via _applyRuntimeIntentDelta) and graph deltas (via _applyIntentDelta) mark as trusted.
    // this._trustHubReconciledIntentRow is now only updated by those two methods when the hub has fully
    // merged the intent (with scene overlay + runtime patches), ensuring _getSceneEffectiveIntent will not
    // re-apply stale YAML overlays on top of hub-merged data.
    this._notify('intents:def')
  }

  // ─── Patch application ───────────────────────────────────────────────────────

  /**
   * Applies a single project key update (`projectPatch` from hub or peers).
   * @param {string} key
   * @param {unknown} data
   */
  applyPatch (key, data) {
    /** @type {string[]} */
    const topics = []
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
        topics.push('fixtures', 'project')
        break
      }
      case 'zoneToRenderer': {
        this._data.zoneToRenderer =
          data && typeof data === 'object' && !Array.isArray(data)
            ? /** @type {Record<string, string[]>} */ (data)
            : {}
        this._spatial = this._computeSpatial()
        this._zoneBoxes = this._computeZoneBoxes()
        topics.push('fixtures', 'project')
        break
      }
      case 'projectName': {
        if (typeof data === 'string') this._data.projectName = data
        topics.push('project')
        break
      }
      case 'activeSceneGuid': {
        if (data === null) {
          this._data.activeSceneGuid = null
        } else if (typeof data === 'string' && data.length > 0) {
          if (this._data.scenes.some(s => s.guid === data)) {
            this._data.activeSceneGuid = data
          }
        } else {
          this._data.activeSceneGuid = null
        }
        topics.push('scenes')
        break
      }
      case 'scenes': {
        const rawScenes = Array.isArray(data)
          ? /** @type {Array<Record<string, unknown>>} */ (data)
          : []
        this._data.scenes = rawScenes.map(normalizeScene).filter(s => s.name)
        if (
          this._data.activeSceneGuid &&
          !this._data.scenes.some(s => s.guid === this._data.activeSceneGuid)
        ) {
          this._data.activeSceneGuid = this._data.scenes[0]?.guid ?? null
        }
        topics.push('scenes')
        break
      }
      case 'actions': {
        this._data.actions = normalizeEntityMap(data)
        topics.push('actions')
        break
      }
      case 'inputs': {
        this._data.inputs = normalizeEntityMap(data)
        topics.push('inputs')
        break
      }
      case 'pulses': {
        this._data.pulses = normalizePulsesConfig(data)
        topics.push('pulses')
        break
      }
      case 'runtimeOverlayGuidsInScene': {
        this._data.runtimeOverlayGuidsInScene = Array.isArray(data)
          ? /** @type {unknown[]} */ (data).filter(d => typeof d === 'string')
          : []
        topics.push('runtimeOverlayHints')
        break
      }
      default:
        break
    }
    this._notify(topics)
  }

  /**
   * Applies the full graph snapshot sent only on registration/reconnect/resync.
   * @param {unknown} payload
   * @param {string} rendererGuid
   */
  applyGraphInit (payload, rendererGuid) {
    // Full-snapshot replace: emit kitchen-sink topics so every pane reconciles once.
    this._withBatch(() => {
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

      const entitiesRaw = p?.entities
      if (
        entitiesRaw &&
        typeof entitiesRaw === 'object' &&
        !Array.isArray(entitiesRaw)
      ) {
        this._data.animations.clear()
        const animationMap = /** @type {Record<string, unknown>} */ (
          entitiesRaw
        ).animation
        if (
          animationMap &&
          typeof animationMap === 'object' &&
          !Array.isArray(animationMap)
        ) {
          this._mergeAnimationsFromEntityMap(
            /** @type {Record<string, Record<string, unknown>>} */ (
              animationMap
            )
          )
        }
      }
    }, [
      'project',
      'scenes',
      'intents:def',
      'fixtures',
      'actions',
      'inputs',
      'pulses',
      'animations',
      'controller',
      'runtimeOverlayHints'
    ])
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
    this._notify('controller')
  }

  /** @returns {Array<{ guid: string }>} copy for hub patch */
  getControllerIntentRefs () {
    return this._data.controller.intentRefs.map(r => ({ guid: r.guid }))
  }

  /** @returns {unknown[]} project `plugins` rows for this controller (from hub `controllerState`). */
  getControllerPlugins () {
    const raw = this._data.controller.state.plugins
    return Array.isArray(raw) ? raw : []
  }

  /** Wake subscribers after `discovery:*` hub messages (plugins resolve iframe URLs). */
  touchDiscovery () {
    this._notify('discovery')
  }

  /**
   * Applies one or more GUID-addressed graph deltas from the hub.
   * @param {unknown} payload
   */
  applyGraphDelta (payload) {
    const deltas = Array.isArray(payload) ? payload : [payload]
    this._withBatch(() => {
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
            this._notify('intents:def')
            break
          case 'fixture':
            this._applyFixtureDelta(guid, op, delta)
            this._notify('fixtures')
            break
          case 'scene':
            this._applySceneDelta(guid, op, delta)
            this._notify('scenes')
            break
          case 'action':
            this._applyEntityDelta(this._data.actions, guid, op, delta)
            this._notify('actions')
            break
          case 'input':
            this._applyEntityDelta(this._data.inputs, guid, op, delta)
            this._notify('inputs')
            break
          case 'animation':
            this._applyEntityDelta(this._data.animations, guid, op, delta)
            this._notify('animations')
            break
          case 'project':
            // _applyProjectDelta touches activeSceneGuid + runtimeOverlayHints.
            this._applyProjectDelta(delta)
            this._notify(['scenes', 'runtimeOverlayHints'])
            break
          case 'controller':
            this._applyControllerDelta(guid, op, delta)
            this._notify('controller')
            break
          default:
            break
        }
      }
    })
  }

  /**
   * Applies hub `runtime:update` deltas into the intents replica (same merge as hub; no parallel map).
   * Hot path: animation drives this every frame, so we only emit `intents:runtime`
   * (and `fixtures` when a fixture patch comes through). Panes that don't subscribe
   * to those topics are not woken.
   * @param {unknown} payload
   */
  applyRuntimeUpdate (payload) {
    const updates = Array.isArray(payload) ? payload : [payload]
    this._withBatch(() => {
      for (const raw of updates) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
        const update = /** @type {Record<string, unknown>} */ (raw)
        const entityType = String(update.entityType ?? '')
        const guid = String(update.guid ?? '')
        if (!entityType || !guid) continue
        switch (entityType) {
          case 'intent':
            this._applyRuntimeIntentDelta(guid, update)
            this._notify('intents:runtime')
            break
          case 'fixture':
            this._applyFixtureDelta(guid, 'patch', update)
            this._notify('fixtures')
            break
          default:
            break
        }
      }
    })
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

    // Full-config replace: coalesce internal `setIntentConfig` etc. into the outer
    // kitchen-sink fire. (When called from `applyGraphInit`, the outer batch wins.)
    this._withBatch(() => {
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
      if (p.pulses !== undefined) {
        this._data.pulses = normalizePulsesConfig(p.pulses)
      }

      const hubActive =
        typeof p.activeSceneGuid === 'string' && p.activeSceneGuid
          ? p.activeSceneGuid
          : null
      if (hubActive && this._data.scenes.some(s => s.guid === hubActive)) {
        this._data.activeSceneGuid = hubActive
      } else if (!this._data.activeSceneGuid && this._data.scenes.length > 0) {
        this._data.activeSceneGuid = this._data.scenes[0].guid
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
    }, ['project', 'scenes', 'fixtures', 'actions', 'inputs', 'pulses', 'controller'])
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
      animations: [...this._data.animations.values()],
      activeSceneGuid: this._data.activeSceneGuid,
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
      this._trustHubReconciledIntentRow.delete(guid)
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
    this._trustHubReconciledIntentRow.add(guid)
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
    const activeScene = this.getActiveSceneName()
    if (activeScene && Object.keys(patch).length > 0) {
      this._stripSceneOverlayKeysOverlappedByPatch(activeScene, guid, patch)
    }
    const current = this._getSceneEffectiveIntent(guid) ??
      /** @type {Record<string, unknown>} */ (this._data.intents.get(guid)) ?? {
        guid
      }
    const value =
      update.value &&
      typeof update.value === 'object' &&
      !Array.isArray(update.value)
        ? /** @type {Record<string, unknown>} */ (update.value)
        : current
    const next = applyDotPathPatch({ ...value, guid }, patch, remove)
    this._data.intents.set(guid, next)
    this._trustHubReconciledIntentRow.add(guid)
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
      if (idx >= 0) {
        const wasActive = this._data.activeSceneGuid === guid
        this._data.scenes.splice(idx, 1)
        if (wasActive) {
          this._data.activeSceneGuid = this._data.scenes[0]?.guid ?? null
        }
      }
      if (
        this._data.activeSceneGuid &&
        !this._data.scenes.some(s => s.guid === this._data.activeSceneGuid)
      ) {
        this._data.activeSceneGuid = this._data.scenes[0]?.guid ?? null
      }
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
    if (
      this._data.activeSceneGuid &&
      !this._data.scenes.some(s => s.guid === this._data.activeSceneGuid)
    ) {
      this._data.activeSceneGuid = this._data.scenes[0]?.guid ?? null
    } else if (!this._data.activeSceneGuid && this._data.scenes.length > 0) {
      this._data.activeSceneGuid = this._data.scenes[0].guid
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
    if (typeof patch.activeSceneGuid === 'string') {
      this._data.activeSceneGuid = patch.activeSceneGuid
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
  const ex = action.execute
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return false
  return ex.type === targetType && ex.guid === targetGuid
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string[]}
 */
function normalizePlayableAnimationTargetIntents (row) {
  if (Array.isArray(row.targetIntents)) {
    /** @type {string[]} */
    const out = []
    const seen = new Set()
    for (const item of row.targetIntents) {
      if (typeof item !== 'string') continue
      const g = item.trim()
      if (!g || seen.has(g)) continue
      seen.add(g)
      out.push(g)
    }
    return out
  }
  const legacy =
    (typeof row.targetIntent === 'string' && row.targetIntent.length > 0
      ? row.targetIntent
      : undefined) ??
    (typeof row.intent === 'string' && row.intent.length > 0 ? row.intent : undefined)
  return legacy ? [legacy] : []
}

/**
 * Runner `action` row shares the animation guid; single execute item runs that animation.
 * @param {Record<string, unknown>} action
 * @param {string} animationGuid
 * @returns {boolean}
 */
function companionAnimationRunnerAction (action, animationGuid) {
  const actionGuid = typeof action.guid === 'string' ? action.guid : ''
  if (actionGuid !== animationGuid) return false
  const ex = action.execute
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return false
  return ex.type === 'animation' && ex.guid === animationGuid
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

/**
 * Normalize a topic argument (string, array, or nullish) into a Set in place.
 * No-op for nullish so call sites that don't yet declare topics still work.
 * @param {Set<string>} target
 * @param {string | string[] | null | undefined} topic
 */
/**
 * @param {unknown} data
 * @returns {{ setups: unknown[], buckets: Array<Record<string, unknown>>, sync?: Record<string, unknown> }}
 */
function normalizePulsesConfig (data) {
  const raw =
    data && typeof data === 'object' && !Array.isArray(data)
      ? /** @type {Record<string, unknown>} */ (data)
      : {}
  const setups = Array.isArray(raw.setups)
    ? /** @type {unknown[]} */ (raw.setups)
        .map(s => {
          if (!s || typeof s !== 'object' || Array.isArray(s)) return null
          const row = /** @type {Record<string, unknown>} */ (s)
          const guid = typeof row.guid === 'string' ? row.guid : ''
          if (!guid) return null
          const name = typeof row.name === 'string' ? row.name : guid
          const bpm =
            typeof row.bpm === 'number' && Number.isFinite(row.bpm)
              ? row.bpm
              : 120
          const meter =
            typeof row.meter === 'number' && Number.isFinite(row.meter)
              ? row.meter
              : 4
          const modeRaw = row.mode
          const mode =
            modeRaw === 'backward' || modeRaw === 'random' ? modeRaw : 'forward'
          const speedRaw = row.speed
          const speed =
            typeof speedRaw === 'number' && Number.isFinite(speedRaw)
              ? clampPulseSetupSpeed(speedRaw)
              : 1
          const slots = Array.isArray(row.slots)
            ? row.slots.map(slot => {
                if (!slot || typeof slot !== 'object' || Array.isArray(slot)) {
                  return {}
                }
                const slotRow = /** @type {Record<string, unknown>} */ (slot)
                const bucket =
                  typeof slotRow.bucket === 'string' && slotRow.bucket.length > 0
                    ? slotRow.bucket
                    : undefined
                const active = slotRow.active === true
                if (!bucket && !active) return {}
                const normalized = /** @type {Record<string, unknown>} */ ({})
                if (bucket) normalized.bucket = bucket
                if (active) normalized.active = true
                return normalized
              })
            : []
          return { guid, name, bpm, meter, mode, speed, slots }
        })
        .filter(
          /** @returns {row is Record<string, unknown>} */ row => row !== null
        )
    : []
  const buckets = Array.isArray(raw.buckets)
    ? /** @type {unknown[]} */ (raw.buckets)
        .map(b => {
          if (!b || typeof b !== 'object' || Array.isArray(b)) return null
          const row = /** @type {Record<string, unknown>} */ (b)
          const guid = typeof row.guid === 'string' ? row.guid : ''
          if (!guid) return null
          const actions = Array.isArray(row.actions)
            ? row.actions.filter(ag => typeof ag === 'string')
            : []
          const name = typeof row.name === 'string' ? row.name : guid
          return { guid, name, actions }
        })
        .filter(
          /** @returns {row is Record<string, unknown>} */ row => row !== null
        )
    : []
  const result = { setups, buckets }
  if (
    raw.sync &&
    typeof raw.sync === 'object' &&
    !Array.isArray(raw.sync)
  ) {
    result.sync = /** @type {Record<string, unknown>} */ (raw.sync)
  }
  return result
}

/**
 * @param {unknown} action
 * @param {string} animationGuid
 * @returns {boolean}
 */
function actionExecuteTargetsAnimation (action, animationGuid) {
  const raw =
    action && typeof action === 'object' && !Array.isArray(action)
      ? /** @type {{ execute?: unknown }} */ (action).execute
      : undefined
  const ex =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? /** @type {Record<string, unknown>} */ (raw)
      : null
  if (!ex) return false
  return ex.type === 'animation' && ex.guid === animationGuid
}

/**
 * @param {unknown} action
 * @param {string} sceneGuid
 * @returns {boolean}
 */
function actionExecuteTargetsScene (action, sceneGuid) {
  const raw =
    action && typeof action === 'object' && !Array.isArray(action)
      ? /** @type {{ execute?: unknown }} */ (action).execute
      : undefined
  const ex =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? /** @type {Record<string, unknown>} */ (raw)
      : null
  if (!ex) return false
  return ex.type === 'scene' && ex.guid === sceneGuid
}

function addTopicsToSet (target, topic) {
  if (topic === null || topic === undefined) return
  if (typeof topic === 'string') {
    target.add(topic)
    return
  }
  if (Array.isArray(topic)) {
    for (const t of topic) {
      if (typeof t === 'string' && t.length > 0) target.add(t)
    }
  }
}

export const projectGraph = new ProjectGraph()
