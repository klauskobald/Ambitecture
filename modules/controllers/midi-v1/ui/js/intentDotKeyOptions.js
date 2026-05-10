/**
 * @param {unknown} d
 * @returns {boolean}
 */
export function isExcludedFromParamsEditor (d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return false
  return (
    /** @type {Record<string, unknown>} */ (d).ignoreInParamsEditor === true
  )
}

/**
 * @param {string} intentClass
 * @param {unknown} systemCapabilities
 * @returns {{ dotKey: string, name: string }[]}
 */
export function listDotKeysForIntentClass (intentClass, systemCapabilities) {
  if (
    !intentClass ||
    !systemCapabilities ||
    typeof systemCapabilities !== 'object' ||
    Array.isArray(systemCapabilities)
  ) {
    return []
  }
  const caps = /** @type {Record<string, unknown>} */ (systemCapabilities)
  const ip = caps.intentProperties
  if (!ip || typeof ip !== 'object' || Array.isArray(ip)) return []
  const list = /** @type {unknown} */ (/** @type {Record<string, unknown>} */ (ip)[
    intentClass
  ])
  if (!Array.isArray(list)) return []
  /** @type {{ dotKey: string, name: string }[]} */
  const out = []
  for (const d of list) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) continue
    if (isExcludedFromParamsEditor(d)) continue
    const rec = /** @type {Record<string, unknown>} */ (d)
    const dotKey = typeof rec.dotKey === 'string' ? rec.dotKey : ''
    if (!dotKey) continue
    const name =
      typeof rec.name === 'string' && rec.name ? rec.name : dotKey
    out.push({ dotKey, name })
  }
  return out
}

/**
 * @param {string} intentGuid
 * @param {(guid: string) => string | null} getIntentClass
 * @param {unknown} systemCapabilities
 * @returns {{ dotKey: string, name: string }[]}
 */
export function listDotKeyOptionsForIntent (
  intentGuid,
  getIntentClass,
  systemCapabilities
) {
  const guid = typeof intentGuid === 'string' ? intentGuid : ''
  const cls = guid && getIntentClass ? getIntentClass(guid) : null
  if (!cls) return []
  return listDotKeysForIntentClass(cls, systemCapabilities)
}
