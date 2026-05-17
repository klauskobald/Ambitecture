import { projectGraph } from '../../core/projectGraph.js'

/**
 * Human-readable line for an action `execute` row (intent / scene / animation / other).
 * @param {Record<string, unknown> | undefined} ex
 * @returns {string}
 */
export function executeTargetSummary (ex) {
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return '—'
  const t = typeof ex.type === 'string' ? ex.type : ''
  const guid = typeof ex.guid === 'string' ? ex.guid : ''
  if (!t || !guid) return '—'
  switch (t) {
    case 'intent': {
      const row = projectGraph.getEffectiveIntent(guid)
      const rec =
        row && typeof row === 'object' && !Array.isArray(row)
          ? /** @type {Record<string, unknown>} */ (row)
          : null
      const name = typeof rec?.name === 'string' ? rec.name.trim() : ''
      return `Intent · ${name.length > 0 ? name : guid}`
    }
    case 'scene': {
      const scenes = projectGraph.getScenesData()
      const hit = Array.isArray(scenes)
        ? scenes.find(
            s =>
              s &&
              typeof s === 'object' &&
              !Array.isArray(s) &&
              /** @type {{ guid?: string }} */ (s).guid === guid
          )
        : undefined
      const name =
        hit && typeof hit === 'object' && !Array.isArray(hit) && typeof hit.name === 'string'
          ? hit.name.trim()
          : ''
      return `Scene · ${name.length > 0 ? name : guid}`
    }
    case 'animation': {
      const row = projectGraph.getAnimations().get(guid)
      const rec =
        row && typeof row === 'object' && !Array.isArray(row)
          ? /** @type {Record<string, unknown>} */ (row)
          : null
      const name = typeof rec?.name === 'string' ? rec.name.trim() : ''
      return `Animation · ${name.length > 0 ? name : guid}`
    }
    default:
      return `${t} · ${guid}`
  }
}
