/**
 * Mirrors hub `effectivePerformResetScene` (modules/hub/src/handlers/intentHelpers.ts).
 * @param {unknown} intent
 */
export function effectivePerformResetSceneFromIntent (intent) {
  if (!intent || typeof intent !== 'object') return true
  const i = /** @type {Record<string, unknown>} */ (intent)
  const clazz = typeof i.class === 'string' ? i.class : ''
  const raw = nestedResetValue(i.perform, 'scene')
  if (typeof raw === 'boolean') return raw
  if (clazz === 'master') return false
  return true
}

/**
 * @param {unknown} perform
 * @param {string} resetKey
 */
function nestedResetValue (perform, resetKey) {
  if (!perform || typeof perform !== 'object' || Array.isArray(perform)) return undefined
  const reset = /** @type {Record<string, unknown>} */ (perform).reset
  if (!reset || typeof reset !== 'object' || Array.isArray(reset)) return undefined
  return reset[resetKey]
}

/**
 * Effective boolean for `perform.reset.<key>` (defaults for unknown keys: true unless explicit).
 * @param {unknown} intent
 * @param {string} key
 */
export function effectivePerformResetForKey (intent, key) {
  if (key === 'scene') return effectivePerformResetSceneFromIntent(intent)
  const raw = intent && typeof intent === 'object' && !Array.isArray(intent)
    ? nestedResetValue(/** @type {Record<string, unknown>} */ (intent).perform, key)
    : undefined
  if (typeof raw === 'boolean') return raw
  return true
}
