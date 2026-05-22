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
 * @param {unknown} raw
 * @returns {{ key: string, name: string }[] | null}
 */
function normalizeComponents (raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null
  /** @type {{ key: string, name: string }[]} */
  const out = []
  for (const c of raw) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) continue
    const rec = /** @type {Record<string, unknown>} */ (c)
    if (rec.key === undefined || rec.key === null) continue
    const key = String(rec.key)
    const name =
      typeof rec.name === 'string' && rec.name ? rec.name : key
    out.push({ key, name })
  }
  return out.length > 0 ? out : null
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
    const components = normalizeComponents(rec.components)
    if (components) {
      const baseLabel = name.trim() || dotKey
      for (const c of components) {
        out.push({
          dotKey: `${dotKey}.${c.key}`,
          name: `${baseLabel} ${c.name}`
        })
      }
      continue
    }
    const dtype = typeof rec.type === 'string' ? rec.type : ''
    if (dtype === 'vector3') {
      const baseLabel = name.trim() || dotKey
      out.push({ dotKey: `${dotKey}.0`, name: `${baseLabel} X` })
      out.push({ dotKey: `${dotKey}.1`, name: `${baseLabel} Y` })
      out.push({ dotKey: `${dotKey}.2`, name: `${baseLabel} Z` })
      continue
    }
    if (dtype === 'color') {
      const baseLabel = name.trim() || dotKey
      out.push({ dotKey: `${dotKey}.h`, name: `${baseLabel} Hue` })
      out.push({ dotKey: `${dotKey}.s`, name: `${baseLabel} Saturation` })
      out.push({ dotKey: `${dotKey}.l`, name: `${baseLabel} Lightness` })
      continue
    }
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
