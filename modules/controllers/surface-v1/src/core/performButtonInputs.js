import { projectGraph } from './projectGraph.js'

/**
 * Controller inputs that appear as Perform pane buttons (display.type === 'button', valid action).
 * @returns {Record<string, unknown>[]}
 */
export function collectPerformButtonInputs () {
  const actions = projectGraph.getActions()
  return [...projectGraph.getInputs().values()].filter(input => {
    const actionGuid = typeof input.action === 'string' ? input.action : ''
    if (!actionGuid || !actions.has(actionGuid)) return false
    const display = input.display
    if (!display || typeof display !== 'object' || Array.isArray(display)) return false
    return /** @type {Record<string, unknown>} */ (display).type === 'button'
  })
}
