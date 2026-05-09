/**
 * Hub `discovery:snapshot` / `discovery:delta` entries keyed by controller guid.
 */

/** @typedef {{ controllerGuid: string, interfaces: Record<string, unknown> }} DiscoveryEntry */

/** @type {Map<string, DiscoveryEntry>} */
const entriesByGuid = new Map()

/**
 * @param {unknown} entries
 */
export function applyDiscoverySnapshot (entries) {
  entriesByGuid.clear()
  if (!Array.isArray(entries)) return
  for (const e of entries) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue
    const rec = /** @type {Record<string, unknown>} */ (e)
    const guid = typeof rec.controllerGuid === 'string' ? rec.controllerGuid : ''
    if (!guid) continue
    entriesByGuid.set(guid, /** @type {DiscoveryEntry} */ (e))
  }
}

/**
 * @param {unknown} payload
 */
export function applyDiscoveryDelta (payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return
  const p = /** @type {Record<string, unknown>} */ (payload)
  const op = p.op
  if (op === 'upsert' && p.entry && typeof p.entry === 'object' && !Array.isArray(p.entry)) {
    const ent = /** @type {Record<string, unknown>} */ (p.entry)
    const guid = typeof ent.controllerGuid === 'string' ? ent.controllerGuid : ''
    if (guid) entriesByGuid.set(guid, /** @type {DiscoveryEntry} */ (p.entry))
    return
  }
  if (op === 'remove') {
    const guid = typeof p.controllerGuid === 'string' ? p.controllerGuid : ''
    if (guid) entriesByGuid.delete(guid)
  }
}

/**
 * @param {string} controllerGuid
 * @returns {DiscoveryEntry | null}
 */
export function getDiscoveryEntry (controllerGuid) {
  return entriesByGuid.get(controllerGuid) ?? null
}
