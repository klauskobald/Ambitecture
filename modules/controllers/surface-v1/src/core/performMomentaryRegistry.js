import { sendActionTrigger } from './outboundQueue.js'
import { projectGraph } from './projectGraph.js'

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | undefined}
 */
function recordOrUndefined (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  return /** @type {Record<string, unknown>} */ (value)
}

/**
 * @param {string} actionGuid
 * @param {'argsOn' | 'argsOff' | 'args'} slot
 * @returns {Record<string, unknown> | undefined}
 */
export function getTriggerSlotArgsFromAction (actionGuid, slot) {
  const action = projectGraph.getActions().get(actionGuid)
  const ex = action?.execute
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return undefined
  const params = recordOrUndefined(ex.params)
  return recordOrUndefined(params?.[slot])
}

/** @type {Map<string, Set<string>>} inputGuid -> source ids (pointer:N, kbd:char, …) */
const sourcesByInputGuid = new Map()

/**
 * @param {string} inputGuid
 * @param {string} sourceId
 * @param {string[]} actionGuids
 */
export function performMomentaryPress (inputGuid, sourceId, actionGuids) {
  if (!inputGuid || !sourceId || !Array.isArray(actionGuids) || actionGuids.length === 0) return
  const set = sourcesByInputGuid.get(inputGuid) ?? new Set()
  const wasInactive = set.size === 0
  set.add(sourceId)
  sourcesByInputGuid.set(inputGuid, set)
  if (wasInactive) {
    for (const ag of actionGuids) {
      sendActionTrigger(ag, getTriggerSlotArgsFromAction(ag, 'argsOn'))
    }
  }
}

/**
 * @param {string} inputGuid
 * @param {string} sourceId
 * @param {string[]} actionGuids
 */
export function performMomentaryRelease (inputGuid, sourceId, actionGuids) {
  if (!inputGuid || !sourceId || !Array.isArray(actionGuids) || actionGuids.length === 0) return
  const set = sourcesByInputGuid.get(inputGuid)
  if (!set) return
  set.delete(sourceId)
  if (set.size > 0) return
  sourcesByInputGuid.delete(inputGuid)
  for (const ag of actionGuids) {
    sendActionTrigger(ag, getTriggerSlotArgsFromAction(ag, 'argsOff'))
  }
}
