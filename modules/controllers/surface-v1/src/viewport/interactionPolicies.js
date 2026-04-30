import {
  updateIntentPosition,
  updateFixturePosition,
  intentGuid,
  getAllowances
} from '../core/stores.js'
import { queueIntentUpdate, queueFixtureUpdate } from '../core/outboundQueue.js'

/**
 * @typedef {object} InteractionPolicy
 * @property {(intent: unknown) => boolean} canDragIntent
 * @property {(fixture: unknown) => boolean} canDragFixture
 * @property {(guid: string, wx: number, wz: number) => void} onIntentMove
 * @property {(id: string, wx: number, wz: number) => void} onFixtureMove
 */

/** @type {InteractionPolicy} */
export const performPolicy = {
  canDragIntent (intent) {
    const guid = intentGuid(intent)
    return !!(getAllowances()[guid]?.performEnabled)
  },
  canDragFixture (_fixture) {
    return false
  },
  onIntentMove (guid, wx, wz) {
    const updated = updateIntentPosition(guid, wx, wz)
    if (updated) queueIntentUpdate(updated)
  },
  onFixtureMove (_id, _wx, _wz) {}
}

/** @type {InteractionPolicy} */
export const editPolicy = {
  canDragIntent (_intent) {
    return true
  },
  canDragFixture (_fixture) {
    return true
  },
  onIntentMove (guid, wx, wz) {
    const updated = updateIntentPosition(guid, wx, wz)
    if (updated) queueIntentUpdate(updated)
  },
  onFixtureMove (id, wx, wz) {
    const fixture = updateFixturePosition(id, wx, wz)
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
  canDragIntent (_intent) { return false },
  canDragFixture (_fixture) { return false },
  onIntentMove (_guid, _wx, _wz) {},
  onFixtureMove (_id, _wx, _wz) {}
}
