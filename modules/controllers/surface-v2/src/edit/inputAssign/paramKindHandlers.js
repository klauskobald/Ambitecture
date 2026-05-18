/**
 * @param {string} raw
 * @param {string} fieldLabel
 * @returns {{ ok: true, value: Record<string, unknown> | undefined } | { ok: false, message: string }}
 */
function tryParseJsonObjectField (raw, fieldLabel) {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, value: undefined }
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        message: `${fieldLabel} must be one JSON object using { ... }, not an array [...] or a bare string.`,
      }
    }
    return { ok: true, value: /** @type {Record<string, unknown>} */ (parsed) }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'parse error'
    return {
      ok: false,
      message: `${fieldLabel} is not valid JSON (${detail}). Example: {"params.alpha":0.5}`,
    }
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function stringifyJsonStringParam (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  return JSON.stringify(value)
}

/**
 * @param {string} kind  value from system.yml `params.<key>` (e.g. jsonString)
 * @param {string} raw   textarea / input text
 * @param {string} fieldLabel
 * @returns {{ ok: true, value: Record<string, unknown> | undefined } | { ok: false, message: string }}
 */
export function parseParamFromForm (kind, raw, fieldLabel) {
  switch (kind) {
    case 'jsonString':
      return tryParseJsonObjectField(raw, fieldLabel)
    default:
      return { ok: false, message: `Unknown param kind "${kind}" for ${fieldLabel}. Add a handler in paramKindHandlers.js.` }
  }
}
