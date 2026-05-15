import { sendActionTrigger } from './outboundQueue.js'

/** @type {Map<string, Set<string>>} inputGuid -> source ids (pointer:N, kbd:char, …) */
const sourcesByInputGuid = new Map()

/**
 * Check if a momentary switch is currently pressed by any source.
 * @param {string} inputGuid
 * @returns {boolean}
 */
export function isMomentaryPressed (inputGuid) {
  if (!inputGuid) return false
  const sources = sourcesByInputGuid.get(inputGuid)
  return sources ? sources.size > 0 : false
}

/**
 * @param {string} inputGuid
 * @param {string} sourceId
 * @param {string[]} actionGuids
 */
export function performMomentaryPress (inputGuid, sourceId, actionGuids) {
  if (
    !inputGuid ||
    !sourceId ||
    !Array.isArray(actionGuids) ||
    actionGuids.length === 0
  )
    return
  const set = sourcesByInputGuid.get(inputGuid) ?? new Set()
  const wasInactive = set.size === 0
  set.add(sourceId)
  sourcesByInputGuid.set(inputGuid, set)
  if (wasInactive) {
    for (const ag of actionGuids) {
      sendActionTrigger(ag, { value: 'on' })
    }
  }
}

/**
 * @param {string} inputGuid
 * @param {string} sourceId
 * @param {string[]} actionGuids
 */
export function performMomentaryRelease (inputGuid, sourceId, actionGuids) {
  if (
    !inputGuid ||
    !sourceId ||
    !Array.isArray(actionGuids) ||
    actionGuids.length === 0
  )
    return
  const set = sourcesByInputGuid.get(inputGuid)
  if (!set) return
  set.delete(sourceId)
  if (set.size > 0) return
  sourcesByInputGuid.delete(inputGuid)
  for (const ag of actionGuids) {
    sendActionTrigger(ag, { value: 'off' })
  }
}

