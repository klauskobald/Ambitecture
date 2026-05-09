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
 * @param {Record<string, unknown>} input
 * @param {string} key
 * @returns {Record<string, unknown> | undefined}
 */
export function getPerformInputArgs (input, key) {
  const params = recordOrUndefined(input.params)
  return recordOrUndefined(params?.[key])
}

/** @type {Map<string, Set<string>>} inputGuid -> source ids (pointer:N, kbd:char, …) */
const sourcesByInputGuid = new Map()

/**
 * @param {string} inputGuid
 * @param {string} sourceId
 * @param {string} actionGuid
 * @param {Record<string, unknown>} inputSnapshot row at press time (argsOn)
 */
export function performMomentaryPress (
  inputGuid,
  sourceId,
  actionGuid,
  inputSnapshot
) {
  if (!inputGuid || !sourceId || !actionGuid) return
  const set = sourcesByInputGuid.get(inputGuid) ?? new Set()
  const wasInactive = set.size === 0
  set.add(sourceId)
  sourcesByInputGuid.set(inputGuid, set)
  if (wasInactive) {
    sendActionTrigger(actionGuid, getPerformInputArgs(inputSnapshot, 'argsOn'))
  }
}

/**
 * @param {string} inputGuid
 * @param {string} sourceId
 * @param {string} actionGuid
 */
export function performMomentaryRelease (inputGuid, sourceId, actionGuid) {
  if (!inputGuid || !sourceId) return
  const set = sourcesByInputGuid.get(inputGuid)
  if (!set) return
  set.delete(sourceId)
  if (set.size > 0) return
  sourcesByInputGuid.delete(inputGuid)
  const input = projectGraph.getInputs().get(inputGuid)
  if (input) {
    sendActionTrigger(actionGuid, getPerformInputArgs(input, 'argsOff'))
  }
}
