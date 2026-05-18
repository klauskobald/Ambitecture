import { selectionState } from '../edit/selectionState.js'
import { projectGraph } from './projectGraph.js'

/** Controller-only hub reasons (v1 animation). */
const REASON_STARTED = 'animation-started'
const REASON_STOPPED = 'animation-stopped'

/** @type {Map<string, string>} intent guid → last lock reason */
const lockedByGuid = new Map()

/** @type {Set<() => void>} */
const listeners = new Set()

function notifyListeners () {
  for (const fn of listeners) fn()
}

/** @param {() => void} fn @returns {() => void} */
export function subscribeIntentLocks (fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** @param {string} guid @returns {boolean} */
export function isIntentLocked (guid) {
  return lockedByGuid.has(guid)
}

/**
 * Apply hub `lock:intent` envelope payload.
 * @param {string} guid
 * @param {string} reason
 */
export function applyIntentLockFromHub (guid, reason) {
  if (!guid || typeof guid !== 'string') return

  if (reason === REASON_STOPPED) {
    lockedByGuid.delete(guid)
  } else if (reason === REASON_STARTED || String(reason).startsWith('animation-')) {
    lockedByGuid.set(guid, reason)
    if (selectionState.hasGuid(guid)) selectionState.removeGuid(guid)
  }

  notifyListeners()
  projectGraph.notifyListeners()
}
