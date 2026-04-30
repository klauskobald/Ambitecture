// Pure utility functions — no state lives here.
// All project state lives in projectGraph.js.

/** @param {unknown} intent @returns {string} */
export function intentGuid (intent) {
  return intent !== null && typeof intent === 'object' && !Array.isArray(intent)
    ? String(/** @type {Record<string, unknown>} */ (intent).guid ?? '')
    : ''
}

/** @param {unknown} intent @returns {number} */
export function intentLayer (intent) {
  if (intent === null || typeof intent !== 'object' || Array.isArray(intent)) return NaN
  return Number(/** @type {Record<string, unknown>} */ (intent).layer)
}

/** @param {unknown} intent @returns {string} */
export function intentName (intent) {
  return intent !== null && typeof intent === 'object' && !Array.isArray(intent)
    ? String(/** @type {Record<string, unknown>} */ (intent).name ?? '')
    : ''
}

/** @param {unknown} intent @returns {number} */
export function intentRadius (intent) {
  if (intent === null || typeof intent !== 'object' || Array.isArray(intent)) return 0
  const raw = /** @type {Record<string, unknown>} */ (intent).radius
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
}

/**
 * @param {string} zoneName
 * @param {string} fixtureName
 * @returns {string}
 */
export function fixtureId (zoneName, fixtureName) {
  return `${zoneName}::${fixtureName}`
}
