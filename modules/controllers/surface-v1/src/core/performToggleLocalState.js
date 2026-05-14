/**
 * Latched on/off for `toggle` perform inputs — browser memory only (not project graph).
 */

import { projectGraph, inputActionGuidList } from './projectGraph.js'
import { isAnimationPlaying } from './animationPlayRegistry.js'

/** @type {Map<string, boolean>} */
const onByInputGuid = new Map()

/**
 * @param {string} inputGuid
 * @returns {boolean}
 */
export function getPerformToggleOn (inputGuid) {
  if (!inputGuid) return false
  return onByInputGuid.get(inputGuid) === true
}

/**
 * Flip latched state; returns hub trigger branch `on` | `off`.
 * @param {string} inputGuid
 * @returns {'on' | 'off'}
 */
export function togglePerformToggleAndGetValue (inputGuid) {
  const next = !(onByInputGuid.get(inputGuid) === true)
  onByInputGuid.set(inputGuid, next)
  return next ? 'on' : 'off'
}

/**
 * @param {string} inputGuid
 */
export function clearPerformToggleState (inputGuid) {
  if (!inputGuid) return
  onByInputGuid.delete(inputGuid)
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeAttr (s) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(s)
  }
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Check if input is highlighted by its action target type (scene, animation, intent, etc).
 * Generic check that works for any button type assigned to any entity type.
 * @param {string} inputGuid
 * @returns {boolean}
 */
function isPerformInputHighlighted (inputGuid) {
  if (!inputGuid) return false
  const input = projectGraph.getInputs().get(inputGuid)
  if (!input) return false

  const ags = inputActionGuidList(
    /** @type {Record<string, unknown>} */ (input)
  )
  for (const actionGuid of ags) {
    const action = projectGraph.getActions().get(actionGuid)
    if (!action) continue

    const ex = action.execute
    if (!ex || typeof ex !== 'object' || Array.isArray(ex)) continue

    switch (ex.type) {
      case 'scene': {
        const activeSceneName = projectGraph.getActiveSceneName()
        const activeSceneGuid = activeSceneName
          ? projectGraph.getSceneGuid(activeSceneName)
          : null
        if (ex.guid === activeSceneGuid) return true
        break
      }
      case 'animation': {
        const animationGuid = typeof ex.guid === 'string' ? ex.guid : ''
        if (animationGuid && isAnimationPlaying(animationGuid)) return true
        break
      }
      case 'intent':
        return false
    }
  }
  return false
}

/**
 * Sync `btn--active` + `aria-pressed` for toggle buttons based on latched state and highlighting.
 * Works for buttons assigned to any action type (scene, animation, intent, etc).
 * @param {string} inputGuid
 */
export function syncPerformToggleChrome (inputGuid) {
  if (!inputGuid) return
  const latched = getPerformToggleOn(inputGuid)
  const highlighted = isPerformInputHighlighted(inputGuid)
  const g = escapeAttr(inputGuid)
  const nodes = document.querySelectorAll(
    `button.perform-input[data-input-guid="${g}"][data-behavior="toggle"]`
  )
  for (const el of nodes) {
    if (!(el instanceof HTMLButtonElement)) continue
    el.classList.toggle('btn--active', latched || highlighted)
    el.setAttribute('aria-pressed', latched ? 'true' : 'false')
  }
}

