import { intentGuid } from '../core/stores.js'
import { projectGraph } from '../core/projectGraph.js'
import { queueIntentUpdate, queueFixtureUpdate, sendSaveProject, sendSceneActivate } from '../core/outboundQueue.js'

/**
 * @typedef {object} InteractionPolicy
 * @property {(intent: unknown) => boolean} isIntentVisible
 * @property {(intent: unknown) => boolean} canDragIntent
 * @property {(fixture: unknown) => boolean} canDragFixture
 * @property {(guid: string, wx: number, wz: number) => void} onIntentMove
 * @property {(guid: string) => void} onIntentMoveEnd
 * @property {(id: string, wx: number, wz: number) => void} onFixtureMove
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

/** @param {string} guid @param {number} wx @param {number} wz @returns {boolean} */
function updatePositionOverlayIfActive (guid, wx, wz) {
  const activeScene = projectGraph.getActiveSceneName()
  if (!activeScene || !projectGraph.isSceneIntentOverlayed(activeScene, guid, 'position')) return false
  const updated = projectGraph.updateRuntimeIntentPosition(guid, wx, wz)
  if (updated) queueIntentUpdate(updated)
  return true
}

/** @param {string} guid @returns {boolean} */
function savePositionOverlayIfActive (guid) {
  const activeScene = projectGraph.getActiveSceneName()
  if (!activeScene || !projectGraph.isSceneIntentOverlayed(activeScene, guid, 'position')) return false
  const position = projectGraph.getEffectiveIntentProperty(guid, 'position')
  if (position !== undefined) projectGraph.setSceneIntentOverlay(activeScene, guid, 'position', position)
  projectGraph.clearRuntimeIntent(guid)
  sendSaveProject('scenes', projectGraph.getScenesData())
  sendSceneActivate(activeScene)
  return true
}

/** @type {InteractionPolicy} */
export const performPolicy = {
  isIntentVisible (intent) {
    return isInActiveScene(intent)
  },
  canDragIntent (intent) {
    const guid = intentGuid(intent)
    return isInActiveScene(intent) && !!(projectGraph.getIntentConfig(guid).performEnabled)
  },
  canDragFixture (_fixture) {
    return false
  },
  onIntentMove (guid, wx, wz) {
    if (updatePositionOverlayIfActive(guid, wx, wz)) return
    const updated = projectGraph.updateIntentPosition(guid, wx, wz)
    if (updated) queueIntentUpdate(updated)
  },
  onIntentMoveEnd (_guid) {},
  onFixtureMove (_id, _wx, _wz) {}
}

/** @type {InteractionPolicy} */
export const editPolicy = {
  isIntentVisible (intent) {
    return isInActiveScene(intent)
  },
  canDragIntent (intent) {
    return isInActiveScene(intent)
  },
  canDragFixture (_fixture) {
    return editFixturesUnlocked
  },
  onIntentMove (guid, wx, wz) {
    if (updatePositionOverlayIfActive(guid, wx, wz)) return
    const updated = projectGraph.updateIntentPosition(guid, wx, wz)
    if (updated) queueIntentUpdate(updated)
  },
  onIntentMoveEnd (guid) {
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
  }
}

/** @type {InteractionPolicy} */
export const noopPolicy = {
  isIntentVisible (_intent) { return false },
  canDragIntent (_intent) { return false },
  canDragFixture (_fixture) { return false },
  onIntentMove (_guid, _wx, _wz) {},
  onIntentMoveEnd (_guid) {},
  onFixtureMove (_id, _wx, _wz) {}
}
