import { PerformButtonScene } from './PerformButtonScene.js'
import { PerformButtonAnimation } from './PerformButtonAnimation.js'
import { PerformButtonIntent } from './PerformButtonIntent.js'
import { PerformButtonToggle } from './PerformButtonToggle.js'
import { PerformButtonMomentarySwitch } from './PerformButtonMomentarySwitch.js'
import { projectGraph, inputActionGuidList } from '../projectGraph.js'

/**
 * Create the appropriate PerformButton subclass for an input.
 * @param {string} inputGuid
 * @param {Record<string, unknown>} inputData
 * @param {HTMLButtonElement} buttonElement
 * @returns {import('./PerformButton.js').PerformButton}
 */
export function createButtonForInput (inputGuid, inputData, buttonElement) {
  const behaviorType = typeof inputData.type === 'string' ? inputData.type : 'button'

  // Route by behavior type first
  if (behaviorType === 'toggle') {
    return new PerformButtonToggle(inputGuid, inputData, buttonElement)
  }
  if (behaviorType === 'momentarySwitch') {
    return new PerformButtonMomentarySwitch(inputGuid, inputData, buttonElement)
  }

  // Default button behavior routes by action target type
  const actionTargetType = getActionTargetType(inputData)

  switch (actionTargetType) {
    case 'scene':
      return new PerformButtonScene(inputGuid, inputData, buttonElement)
    case 'animation':
      return new PerformButtonAnimation(inputGuid, inputData, buttonElement)
    case 'intent':
      return new PerformButtonIntent(inputGuid, inputData, buttonElement)
    default:
      return new PerformButtonIntent(inputGuid, inputData, buttonElement)
  }
}

/**
 * Determine the action target type from input data.
 * @param {Record<string, unknown>} inputData
 * @returns {string | null}
 */
function getActionTargetType (inputData) {
  const ags = inputActionGuidList(inputData)
  if (ags.length === 0) return null
  const action = projectGraph.getActions().get(ags[0])
  if (!action) return null
  const ex = action.execute
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return null
  return typeof ex.type === 'string' ? ex.type : null
}


