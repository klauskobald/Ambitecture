import { projectGraph } from './projectGraph.js'

/**
 * `keyChar` from project YAML may be an unquoted number (e.g. `keyChar: 1`).
 * Bindings and labels must use a string so they match `KeyboardEvent.key`.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeInputKeyChar (raw) {
  if (raw == null) return ''
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  if (typeof raw === 'string') {
    const t = raw.trim()
    return t
  }
  return ''
}

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
