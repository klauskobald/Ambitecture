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
