import { projectGraph } from '../../core/projectGraph.js'
import { readAtDotPath } from '../../core/dotPath.js'

/**
 * Read a value from an intent object using dot-notation path.
 * @param {Record<string, unknown>} intentObj
 * @param {string} dotKey
 * @returns {unknown}
 */
export { readAtDotPath }

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function deepEqual (a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Inspect all selected intents for a given dotKey.
 * @param {Set<string>} guids
 * @param {string} dotKey
 * @returns {{ mode: 'same' | 'mixed' | 'absent', value: unknown }}
 */
export function resolveMultiSelectState (guids, dotKey) {
  const values = []
  for (const guid of guids) {
    const val = projectGraph.getEffectiveIntentProperty(guid, dotKey)
    if (val !== undefined) values.push(val)
  }
  if (values.length === 0) return { mode: 'absent', value: undefined }
  const first = values[0]
  const allSame = values.every(v => deepEqual(v, first))
  return allSame
    ? { mode: 'same', value: first }
    : { mode: 'mixed', value: undefined }
}

/**
 * @param {Set<string>} guids
 * @param {string} dotKey
 * @returns {'on' | 'off' | 'mixed'}
 */
export function resolveEnableState (guids, dotKey) {
  let presentCount = 0
  let total = 0
  for (const guid of guids) {
    if (!projectGraph.getIntents().has(guid)) continue
    total++
    if (projectGraph.getEffectiveIntentProperty(guid, dotKey) !== undefined) presentCount++
  }
  if (total === 0 || presentCount === 0) return 'off'
  if (presentCount === total) return 'on'
  return 'mixed'
}

/**
 * Apply a delta to a value using the specified function, clamped to [min, max].
 * ADD:      newVal = original + delta
 * MULTIPLY: newVal = original * delta  (delta=1.0 → no change)
 * @param {number} original
 * @param {number} delta
 * @param {'ADD' | 'MULTIPLY' | string} fn
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function applyDelta (original, delta, fn, min, max) {
  const result = fn === 'MULTIPLY'
    ? original * delta
    : original + delta
  return Math.max(min, Math.min(max, result))
}
