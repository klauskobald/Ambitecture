import { intentGuid } from '../core/stores.js'
import { projectGraph } from '../core/projectGraph.js'
import { isIntentLocked } from '../core/intentLockRegistry.js'
import {
  queueIntentUpdate,
  queueIntentDragMove,
  queueIntentDragEnd,
  queueFixtureUpdate,
  sendGraphCommand,
  sendSaveProject,
  sendSceneActivate
} from '../core/outboundQueue.js'

/**
 * @typedef {object} InteractionPolicy
 * @property {(intent: unknown) => boolean} isIntentVisible
 * @property {(intent: unknown) => boolean} canDragIntent
 * @property {(fixture: unknown) => boolean} canDragFixture
 * @property {(guid: string, wx: number, wz: number) => void} onIntentMove
 * @property {(guid: string) => void} onIntentMoveEnd
 * @property {(guid: string, wy: number) => void} onIntentHeightMove
 * @property {(guid: string) => void} onIntentHeightMoveEnd
 * @property {(id: string, wx: number, wz: number) => void} onFixtureMove
 * @property {(id: string, wy: number) => void} onFixtureHeightMove
 * @property {(id: string) => void} onFixtureHeightMoveEnd
 */

/** @param {unknown} intent @returns {boolean} */
function isInActiveScene (intent) {
  const guid = intentGuid(intent)
  const activeScene = projectGraph.getActiveSceneName()
  if (!activeScene) return true
  return projectGraph.getSceneIntents(activeScene).includes(guid)
}

let editFixturesUnlocked = false

/** @param {boolean} unlocked */
export function setEditFixturesUnlocked (unlocked) {
  editFixturesUnlocked = unlocked
}

/** @returns {boolean} */
export function getEditFixturesUnlocked () {
  return editFixturesUnlocked
}

/** Perform pane: overlayed position streams via hub runtime merge (perform semantics). */
function updatePerformPositionOverlayIfActive (guid, wx, wz) {
  const activeScene = projectGraph.getActiveSceneName()
  if (
    !activeScene ||
    !projectGraph.isSceneIntentOverlayed(activeScene, guid, 'position')
  )
    return false
  const updated = projectGraph.updateRuntimeIntentPosition(guid, wx, wz)
  if (updated) queueIntentUpdate(updated)
  return true
}

/** Height (y) twin of {@link updatePerformPositionOverlayIfActive}. */
function updatePerformHeightOverlayIfActive (guid, wy) {
  const activeScene = projectGraph.getActiveSceneName()
  if (
    !activeScene ||
    !projectGraph.isSceneIntentOverlayed(activeScene, guid, 'position')
  )
    return false
  const updated = projectGraph.updateRuntimeIntentHeight(guid, wy)
  if (updated) queueIntentUpdate(updated)
  return true
}

/**
 * Edit pane: overlayed position is durable scene YAML only — mutate local overlay, no runtime:command.
 * @param {string} guid
 * @param {number} wx
 * @param {number} wz
 * @returns {boolean}
 */
function updateEditPositionOverlayIfActive (guid, wx, wz) {
  const activeScene = projectGraph.getActiveSceneName()
  if (
    !activeScene ||
    !projectGraph.isSceneIntentOverlayed(activeScene, guid, 'position')
  )
    return false
  const cur = projectGraph.getEffectiveIntentProperty(guid, 'position')
  const y = Array.isArray(cur) ? Number(cur[1] ?? 0) : 0
  projectGraph.setSceneIntentOverlay(activeScene, guid, 'position', [wx, y, wz])
  return true
}

/**
 * Edit pane height (y) twin of {@link updateEditPositionOverlayIfActive}: preserve x/z.
 * @param {string} guid
 * @param {number} wy
 * @returns {boolean}
 */
function updateEditHeightOverlayIfActive (guid, wy) {
  const activeScene = projectGraph.getActiveSceneName()
  if (
    !activeScene ||
    !projectGraph.isSceneIntentOverlayed(activeScene, guid, 'position')
  )
    return false
  const cur = projectGraph.getEffectiveIntentProperty(guid, 'position')
  const x = Array.isArray(cur) ? Number(cur[0] ?? 0) : 0
  const z = Array.isArray(cur) ? Number(cur[2] ?? 0) : 0
  projectGraph.setSceneIntentOverlay(activeScene, guid, 'position', [x, wy, z])
  return true
}

/** @param {string} guid @returns {boolean} */
function savePositionOverlayIfActive (guid) {
  const activeScene = projectGraph.getActiveSceneName()
  if (
    !activeScene ||
    !projectGraph.isSceneIntentOverlayed(activeScene, guid, 'position')
  )
    return false
  sendSaveProject('scenes', projectGraph.getScenesData())
  const sceneGuid = projectGraph.getSceneGuid(activeScene)
  if (sceneGuid) sendSceneActivate(sceneGuid)
  return true
}

/** @type {InteractionPolicy} */
export const performPolicy = {
  isIntentVisible (intent) {
    return isInActiveScene(intent)
  },
  canDragIntent (intent) {
    const guid = intentGuid(intent)
    if (!guid || isIntentLocked(guid)) return false
    return (
      isInActiveScene(intent) &&
      !!projectGraph.getIntentConfig(guid).performEnabled
    )
  },
  canDragFixture (_fixture) {
    return false
  },
  onIntentMove (guid, wx, wz) {
    if (updatePerformPositionOverlayIfActive(guid, wx, wz)) return
    const intent = projectGraph.getIntents().get(guid)
    if (!intent) return
    const i = /** @type {Record<string, unknown>} */ (intent)
    const pos = /** @type {number[] | undefined} */ (i.position)
    const position = /** @type {[number, number, number]} */ ([
      wx,
      pos?.[1] ?? 0,
      wz
    ])
    // Perform drag goes through the hub physics drag anchor (mass-based lag, connected intents follow).
    queueIntentDragMove(guid, position)
  },
  onIntentMoveEnd (guid) {
    queueIntentDragEnd(guid)
  },
  onIntentHeightMove (guid, wy) {
    if (updatePerformHeightOverlayIfActive(guid, wy)) return
    const updated = projectGraph.updateRuntimeIntentHeight(guid, wy)
    if (updated) queueIntentUpdate(updated)
  },
  onIntentHeightMoveEnd (_guid) {},
  onFixtureMove (_id, _wx, _wz) {},
  onFixtureHeightMove (_id, _wy) {},
  onFixtureHeightMoveEnd (_id) {}
}

/** @type {InteractionPolicy} */
export const editPolicy = {
  isIntentVisible (intent) {
    return isInActiveScene(intent)
  },
  canDragIntent (intent) {
    const guid = intentGuid(intent)
    if (!guid || isIntentLocked(guid)) return false
    return isInActiveScene(intent)
  },
  canDragFixture (_fixture) {
    return editFixturesUnlocked
  },
  onIntentMove (guid, wx, wz) {
    if (updateEditPositionOverlayIfActive(guid, wx, wz)) return
    const updated = projectGraph.updateIntentPosition(guid, wx, wz)
    if (updated) queueIntentUpdate(updated)
  },
  onIntentMoveEnd (guid) {
    if (savePositionOverlayIfActive(guid)) return
    this._updateConnectorRestLengths(guid)
    sendSaveProject('intents', [...projectGraph.getIntents().values()])
  },

  /** After an edit-mode drag, update every connector touching this intent so its restLength
   *  reflects the new current distance — physics picks it up cleanly when re-enabled. */
  _updateConnectorRestLengths (guid) {
    for (const c of projectGraph.getConnectorsForIntent(guid)) {
      const aPos = this._intentPosition(c.aGuid)
      const bPos = this._intentPosition(c.bGuid)
      if (!aPos || !bPos) continue
      const dx = aPos[0] - bPos[0]
      const dy = aPos[1] - bPos[1]
      const dz = aPos[2] - bPos[2]
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      sendGraphCommand({
        op: 'patch',
        entityType: 'connector',
        guid: c.guid,
        patch: { restLength: dist },
        persistence: 'runtimeAndDurable'
      })
    }
  },

  /** @param {string} guid @returns {[number,number,number] | null} */
  _intentPosition (guid) {
    if (!guid) return null
    const intent = projectGraph.getEffectiveIntent(guid)
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return null
    const pos = /** @type {unknown} */ (intent).position
    if (Array.isArray(pos) && pos.length === 3) {
      return [Number(pos[0]), Number(pos[1]), Number(pos[2])]
    }
    return null
  },
  onIntentHeightMove (guid, wy) {
    if (updateEditHeightOverlayIfActive(guid, wy)) return
    const updated = projectGraph.updateIntentHeight(guid, wy)
    if (updated) queueIntentUpdate(updated)
  },
  onIntentHeightMoveEnd (guid) {
    if (savePositionOverlayIfActive(guid)) return
    sendSaveProject('intents', [...projectGraph.getIntents().values()])
  },
  onFixtureMove (id, wx, wz) {
    const fixture = projectGraph.updateFixturePosition(id, wx, wz)
    if (!fixture) return
    queueFixtureUpdate({
      guid: fixture.guid,
      zoneName: fixture.zoneName,
      fixtureName: fixture.fixtureName,
      position: fixture.position
    })
  },
  onFixtureHeightMove (id, wy) {
    const fixture = projectGraph.updateFixtureHeight(id, wy)
    if (!fixture) return
    queueFixtureUpdate({
      guid: fixture.guid,
      zoneName: fixture.zoneName,
      fixtureName: fixture.fixtureName,
      position: fixture.position
    })
  },
  onFixtureHeightMoveEnd (_id) {}
}

/** @type {InteractionPolicy} */
export const noopPolicy = {
  isIntentVisible (_intent) {
    return false
  },
  canDragIntent (_intent) {
    return false
  },
  canDragFixture (_fixture) {
    return false
  },
  onIntentMove (_guid, _wx, _wz) {},
  onIntentMoveEnd (_guid) {},
  onIntentHeightMove (_guid, _wy) {},
  onIntentHeightMoveEnd (_guid) {},
  onFixtureMove (_id, _wx, _wz) {},
  onFixtureHeightMove (_id, _wy) {},
  onFixtureHeightMoveEnd (_id) {}
}
