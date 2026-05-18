/** @typedef {Record<string, Record<string, number[]>>} LayoutSplitsMap */

/**
 * @typedef {object} LayoutSplitStorage
 * @property {string} [activeLayoutId]
 * @property {LayoutSplitsMap} splits
 */

const STORAGE_KEY = 'ambitecture.surface-v2.layoutSplits'

/** @deprecated migration source */
const LEGACY_PREFIX = 'ambitecture.surface-v2.layoutSplit.r1.'

/**
 * @returns {LayoutSplitStorage}
 */
function readState () {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { splits: {} }
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { splits: {} }
    }
    const o = /** @type {Record<string, unknown>} */ (parsed)
    const splits = o.splits
    const activeLayoutId =
      typeof o.activeLayoutId === 'string' ? o.activeLayoutId : undefined
    if (splits === null || typeof splits !== 'object' || Array.isArray(splits)) {
      return { splits: {}, activeLayoutId }
    }
    return { splits: /** @type {LayoutSplitsMap} */ (splits), activeLayoutId }
  } catch {
    return { splits: {} }
  }
}

/**
 * @param {LayoutSplitStorage} state
 */
function writeState (state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * @param {unknown} raw
 * @param {number} panelCount
 * @returns {number[]}
 */
function normalizeFractions (raw, panelCount) {
  const equal = 1 / panelCount
  if (!Array.isArray(raw) || raw.length !== panelCount) {
    return Array.from({ length: panelCount }, () => equal)
  }
  const nums = raw.map(Number)
  if (nums.some(n => !Number.isFinite(n) || n <= 0)) {
    return Array.from({ length: panelCount }, () => equal)
  }
  const sum = nums.reduce((a, b) => a + b, 0)
  if (sum <= 0) return Array.from({ length: panelCount }, () => equal)
  return nums.map(n => n / sum)
}

/**
 * @param {string} layoutId
 * @param {string} nodePath
 * @param {number} panelCount
 * @returns {number[]}
 */
export function loadSplitFractions (layoutId, nodePath, panelCount) {
  const state = readState()
  const layoutSplits = state.splits[layoutId]
  if (layoutSplits && nodePath in layoutSplits) {
    return normalizeFractions(layoutSplits[nodePath], panelCount)
  }

  const legacy = loadLegacyFractions(layoutId, nodePath, panelCount)
  if (legacy) {
    saveSplitFractions(layoutId, nodePath, legacy)
    return legacy
  }

  return normalizeFractions(null, panelCount)
}

/**
 * @param {string} layoutId
 * @param {string} nodePath
 * @param {number[]} fractions
 */
export function saveSplitFractions (layoutId, nodePath, fractions) {
  const normalized = normalizeFractions(fractions, fractions.length)
  const state = readState()
  if (!state.splits[layoutId]) state.splits[layoutId] = {}
  state.splits[layoutId][nodePath] = normalized
  writeState(state)
}

/**
 * @returns {string | null}
 */
export function loadActiveLayoutId () {
  const state = readState()
  return state.activeLayoutId ?? null
}

/**
 * @param {string} layoutId
 */
export function saveActiveLayoutId (layoutId) {
  const state = readState()
  state.activeLayoutId = layoutId
  writeState(state)
}

/**
 * @returns {LayoutSplitsMap}
 */
export function loadAllSplitState () {
  return readState().splits
}

/**
 * @param {string} layoutId
 * @param {string} nodePath
 * @param {number} panelCount
 * @returns {number[] | null}
 */
function loadLegacyFractions (layoutId, nodePath, panelCount) {
  try {
    const raw = localStorage.getItem(`${LEGACY_PREFIX}${layoutId}.${nodePath}`)
    if (raw === null) return null
    const parsed = JSON.parse(raw)
    return normalizeFractions(parsed, panelCount)
  } catch {
    return null
  }
}
