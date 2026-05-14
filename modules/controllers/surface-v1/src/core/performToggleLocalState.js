/**
 * Latched on/off for `toggle` perform inputs — browser memory only (not project graph).
 */

import { projectGraph } from './projectGraph.js'

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
 * True when this input is the active scene's linked perform button.
 * @param {string} inputGuid
 * @returns {boolean}
 */
function isPerformInputSceneHighlighted (inputGuid) {
  if (!inputGuid) return false
  const activeSceneName = projectGraph.getActiveSceneName()
  const activeSceneGuid = activeSceneName
    ? projectGraph.getSceneGuid(activeSceneName)
    : null
  const scenePerformInput =
    activeSceneGuid && projectGraph.getSceneButtonInput(activeSceneGuid)
  const highlightedGuid = scenePerformInput
    ? String(scenePerformInput.guid ?? '')
    : ''
  return highlightedGuid !== '' && highlightedGuid === inputGuid
}

/**
 * Sync `btn--active` (same as scene-highlighted perform buttons) + `aria-pressed` for strip toggles.
 * @param {string} inputGuid
 */
export function syncPerformToggleChrome (inputGuid) {
  if (!inputGuid) return
  const latched = getPerformToggleOn(inputGuid)
  const sceneHl = isPerformInputSceneHighlighted(inputGuid)
  const g = escapeAttr(inputGuid)
  const nodes = document.querySelectorAll(
    `button.perform-input[data-input-guid="${g}"][data-behavior="toggle"]`
  )
  for (const el of nodes) {
    if (!(el instanceof HTMLButtonElement)) continue
    el.classList.toggle('btn--active', latched || sceneHl)
    el.setAttribute('aria-pressed', latched ? 'true' : 'false')
  }
}
