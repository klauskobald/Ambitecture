import { intentGuid } from '../core/stores.js'
import { projectGraph } from '../core/projectGraph.js'
import { queueIntentUpdate, queueFixtureUpdate, sendSaveProject } from '../core/outboundQueue.js'

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
    return true
  },
  onIntentMove (guid, wx, wz) {
    const updated = projectGraph.updateIntentPosition(guid, wx, wz)
    if (updated) queueIntentUpdate(updated)
  },
  onIntentMoveEnd (_guid) {
    sendSaveProject('intents', [...projectGraph.getIntents().values()])
  },
  onFixtureMove (id, wx, wz) {
    const fixture = projectGraph.updateFixturePosition(id, wx, wz)
    if (!fixture) return
    queueFixtureUpdate({
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
