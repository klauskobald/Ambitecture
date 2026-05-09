import { projectGraph } from './projectGraph.js'

/**
 * Controller inputs that appear as Perform pane buttons (display.type === 'button').
 * Includes unassigned rows (no action / stale action guid) so they stay visible with an badge.
 * @returns {Record<string, unknown>[]}
 */
export function collectPerformButtonInputs () {
  return [...projectGraph.getInputs().values()].filter(input => {
    const display = input.display
    if (!display || typeof display !== 'object' || Array.isArray(display))
      return false
    return /** @type {Record<string, unknown>} */ (display).type === 'button'
  })
}
