/**
 * Animation `targetIntents` helpers (canonical multi-target; legacy singular fields on read).
 */

import { projectGraph } from '../core/projectGraph.js'
import { sendGraphCommand } from '../core/outboundQueue.js'

/**
 * @param {Record<string, unknown> | undefined} record
 * @returns {string[]}
 */
export function normalizeAnimationTargetIntents (record) {
  if (!record) return []

  if (Array.isArray(record.targetIntents)) {
    /** @type {string[]} */
    const out = []
    const seen = new Set()
    for (const item of record.targetIntents) {
      if (typeof item !== 'string') continue
      const g = item.trim()
      if (!g || seen.has(g)) continue
      seen.add(g)
      out.push(g)
    }
    return out
  }

  const legacy =
    (typeof record.targetIntent === 'string' && record.targetIntent.length > 0
      ? record.targetIntent
      : undefined) ??
    (typeof record.intent === 'string' && record.intent.length > 0
      ? record.intent
      : undefined)
  return legacy ? [legacy] : []
}

/**
 * @param {Record<string, unknown> | undefined} record
 * @param {string} intentGuid
 * @returns {boolean}
 */
export function animationHasTargetIntent (record, intentGuid) {
  if (!intentGuid) return false
  return normalizeAnimationTargetIntents(record).includes(intentGuid)
}

/**
 * @param {string} guid
 * @returns {string}
 */
export function resolveIntentName (guid) {
  if (!guid) return ''
  const intent = /** @type {Record<string, unknown> | undefined} */ (
    projectGraph.getIntents().get(guid)
  )
  const name = intent?.name
  return typeof name === 'string' && name ? name : guid
}

/**
 * @param {string[]} guids
 * @param {{ maxNames?: number }} [opts]
 * @returns {string}
 */
export function formatAnimationTargetsSummary (guids, opts = {}) {
  const maxNames = typeof opts.maxNames === 'number' ? opts.maxNames : 2
  if (!guids.length) return 'No targets'
  const names = guids.map(resolveIntentName)
  if (names.length <= maxNames) return names.join(', ')
  const shown = names.slice(0, maxNames).join(', ')
  return `${shown} +${names.length - maxNames}`
}

/**
 * @param {string[]} guids
 * @returns {string}
 */
export function formatAnimationTargetsTitle (guids) {
  if (!guids.length) return 'No target intents assigned'
  return guids.map(g => resolveIntentName(g)).join(', ')
}

/**
 * @param {string} animationGuid
 * @param {string[]} guids unique intent guids
 */
export function sendAnimationTargetIntentsPatch (animationGuid, guids) {
  const unique = []
  const seen = new Set()
  for (const g of guids) {
    if (typeof g !== 'string') continue
    const t = g.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    unique.push(t)
  }

  /** @type {Record<string, unknown>} */
  const patch = { targetIntents: unique }

  sendGraphCommand({
    op: 'upsert',
    entityType: 'animation',
    guid: animationGuid,
    patch,
    persistence: 'runtimeAndDurable'
  })
  projectGraph.applyGraphDelta({
    entityType: 'animation',
    op: 'upsert',
    guid: animationGuid,
    patch
  })
}

/**
 * @param {string} animationGuid
 * @param {string} intentGuid
 */
export function addAnimationTargetIntent (animationGuid, intentGuid) {
  const record = projectGraph.getAnimations().get(animationGuid)
  const row =
    record && typeof record === 'object' && !Array.isArray(record)
      ? /** @type {Record<string, unknown>} */ (record)
      : undefined
  const current = normalizeAnimationTargetIntents(row)
  if (current.includes(intentGuid)) return
  sendAnimationTargetIntentsPatch(animationGuid, [...current, intentGuid])
}
