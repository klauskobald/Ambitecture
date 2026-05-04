/** @type {Record<string, unknown> | null} */
let _caps = null

/** @param {unknown} payload */
export function applySystemCapabilities (payload) {
  _caps = /** @type {Record<string, unknown>} */ (payload)
}

/** @returns {Record<string, unknown> | null} */
export function getCapabilities () { return _caps }

/**
 * Returns resolved descriptors for the given intent class, with optionsRef
 * resolved into actual string arrays from the top-level capabilities object.
 * Returns null if systemCapabilities has not yet been received from the hub.
 * @param {string} intentClass
 * @returns {unknown[] | null}
 */
export function resolveDescriptorsForClass (intentClass) {
  if (!_caps) return null
  const intentProperties = /** @type {Record<string, unknown>} */ (_caps.intentProperties ?? {})
  const raw = /** @type {unknown[] | undefined} */ (intentProperties[intentClass])
  if (!raw) return null
  return raw.map(entry => {
    const d = /** @type {Record<string, unknown>} */ (entry)
    if (typeof d.optionsRef === 'string') {
      return { ...d, options: _caps?.[d.optionsRef] ?? [] }
    }
    return d
  })
}

/**
 * @typedef {{ class: string, name: string, hint: string, params: Record<string, string> }} CapabilityInputType
 * @typedef {{ class: string, name: string }} CapabilityDisplayType
 */

/**
 * @param {unknown} raw
 * @returns {CapabilityInputType | null}
 */
function normalizeInputTypeEntry (raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = /** @type {Record<string, unknown>} */ (raw)
  const cls = typeof r.class === 'string' && r.class.length > 0 ? r.class : ''
  if (!cls) return null
  const name = typeof r.name === 'string' && r.name.length > 0 ? r.name : cls
  const hint = typeof r.hint === 'string' ? r.hint : ''
  const paramsRaw = r.params
  /** @type {Record<string, string>} */
  const params = {}
  if (paramsRaw && typeof paramsRaw === 'object' && !Array.isArray(paramsRaw)) {
    for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (paramsRaw))) {
      if (typeof v === 'string' && v.length > 0) params[k] = v
    }
  }
  return { class: cls, name, hint, params }
}

/**
 * @param {unknown} raw
 * @returns {CapabilityDisplayType | null}
 */
function normalizeDisplayTypeEntry (raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = /** @type {Record<string, unknown>} */ (raw)
  const cls = typeof r.class === 'string' && r.class.length > 0 ? r.class : ''
  if (!cls) return null
  const name = typeof r.name === 'string' && r.name.length > 0 ? r.name : cls
  return { class: cls, name }
}

/**
 * Perform input kinds from hub `systemCapabilities.inputTypes` (pushed on register).
 * @returns {CapabilityInputType[] | null}
 */
export function getInputTypes () {
  if (!_caps) return null
  const raw = /** @type {unknown[] | undefined} */ (_caps.inputTypes)
  if (!Array.isArray(raw)) return null
  const out = []
  for (const item of raw) {
    const n = normalizeInputTypeEntry(item)
    if (n) out.push(n)
  }
  return out.length > 0 ? out : null
}

/**
 * Perform display kinds from hub `systemCapabilities.displayTypes`.
 * @returns {CapabilityDisplayType[] | null}
 */
export function getDisplayTypes () {
  if (!_caps) return null
  const raw = /** @type {unknown[] | undefined} */ (_caps.displayTypes)
  if (!Array.isArray(raw)) return null
  const out = []
  for (const item of raw) {
    const n = normalizeDisplayTypeEntry(item)
    if (n) out.push(n)
  }
  return out.length > 0 ? out : null
}
