/** @param {unknown} raw */
export function cloneParamSlice (raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return { .../** @type {Record<string, unknown>} */ (raw) }
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | undefined}
 */
export function recordOrUndefined (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  return /** @type {Record<string, unknown>} */ (value)
}
