import { projectGraph, inputActionGuidList } from '../../core/projectGraph.js'

/**
 * Resolves the graph intent `class` for the first linked action whose execute targets an intent,
 * for `systemCapabilities.intentProperties[class]`.
 *
 * @param {string} inputGuid
 * @returns {string | null}
 */
export function getIntentClassForInput (inputGuid) {
  if (!inputGuid) return null
  const input = projectGraph.getInputs().get(inputGuid)
  if (!input) return null
  for (const actionGuid of inputActionGuidList(/** @type {Record<string, unknown>} */ (input))) {
    const action = projectGraph.getActions().get(actionGuid)
    const ex = action?.execute
    if (
      !ex ||
      typeof ex !== 'object' ||
      Array.isArray(ex) ||
      ex.type !== 'intent' ||
      typeof ex.guid !== 'string' ||
      ex.guid.length === 0
    ) {
      continue
    }
    const intent = projectGraph.getEffectiveIntent(ex.guid)
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) continue
    const rec = /** @type {Record<string, unknown>} */ (intent)
    const cls = rec.class
    if (typeof cls === 'string' && cls.length > 0) return cls
  }
  return null
}
