import { KeyframeAnimatorViewer } from './keyframeAnimator.js'

/** @type {Map<string, import('./AnimatorViewer.js').AnimatorViewer>} */
const registry = new Map([
  ['keyframeAnimator', new KeyframeAnimatorViewer()],
])

/**
 * @param {string} className
 * @returns {import('./AnimatorViewer.js').AnimatorViewer | null}
 */
export function getAnimatorViewer (className) {
  return registry.get(className) ?? null
}
