import { projectGraph } from '../../core/projectGraph.js'

/**
 * Resolves the graph intent `class` for the first `execute` item of type `intent`
 * linked from the input, for `systemCapabilities.intentProperties[class]`.
 *
 * @param {string} inputGuid
 * @returns {string | null}
 */
export function getIntentClassForInput (inputGuid) {
  if (!inputGuid) return null
  const input = projectGraph.getInputs().get(inputGuid)
  if (!input) return null
  const actionGuid = typeof input.action === 'string' ? input.action : ''
  if (!actionGuid) return null
  const action = projectGraph.getActions().get(actionGuid)
  if (!action || !Array.isArray(action.execute)) return null
  const intentItem = action.execute.find(
    e =>
      e &&
      typeof e === 'object' &&
      !Array.isArray(e) &&
      e.type === 'intent' &&
      typeof e.guid === 'string' &&
      e.guid.length > 0
  )
  if (!intentItem || typeof intentItem !== 'object') return null
  const guid = /** @type {{ guid: string }} */ (intentItem).guid
  const intent = projectGraph.getEffectiveIntent(guid)
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return null
  const rec = /** @type {Record<string, unknown>} */ (intent)
  const cls = rec.class
  return typeof cls === 'string' && cls.length > 0 ? cls : null
}
