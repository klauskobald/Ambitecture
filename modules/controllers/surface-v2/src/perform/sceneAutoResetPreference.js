const STORAGE_KEY = 'surface-v2.sceneAutoResetOnLoad'

/** @type {Set<() => void>} */
const listeners = new Set()

/** @returns {boolean} */
export function isSceneAutoResetOnLoadEnabled () {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** @param {boolean} enabled */
export function setSceneAutoResetOnLoadEnabled (enabled) {
  try {
    if (enabled) {
      localStorage.setItem(STORAGE_KEY, '1')
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    /* ignore quota / private mode */
  }
  for (const fn of listeners) fn()
}

/** @param {() => void} fn */
export function subscribeSceneAutoResetOnLoadChange (fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * @param {{ runtimeMergeClear?: 'scene' | 'all' }} opts
 * @returns {{ runtimeMergeClear?: 'scene' | 'all' }}
 */
export function sceneActivateOptsWithAutoReset (opts = {}) {
  if (opts.runtimeMergeClear === 'all' || opts.runtimeMergeClear === 'scene') {
    return opts
  }
  if (!isSceneAutoResetOnLoadEnabled()) return opts
  return { ...opts, runtimeMergeClear: 'scene' }
}
