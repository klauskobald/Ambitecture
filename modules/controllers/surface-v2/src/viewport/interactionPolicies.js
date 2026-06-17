import { intentGuid } from '../core/stores.js'
import { projectGraph } from '../core/projectGraph.js'
import { isIntentLocked } from '../core/intentLockRegistry.js'
import {
  queueIntentUpdate,
  queueFixtureUpdate,
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
    queueIntentUpdate({ guid, patch: { position } })
  },
  onIntentMoveEnd (_guid) {},
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
    sendSaveProject('intents', [...projectGraph.getIntents().values()])
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
