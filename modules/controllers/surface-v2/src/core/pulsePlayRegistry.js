/**
 * Tracks pulse setup play state from hub `hub:status` (kind === 'pulse').
 * Multiple setups may run concurrently. Used by Perform → Pulse list UI.
 */

/** @type {Set<string>} */
const runningSetupGuids = new Set()

/** @type {string | null} */
let focusedSetupGuid = null

/** @type {Map<string, { bpm: number, speed: number, slotIdx: number, slotsTotal: number, message: string }>} */
const slotStateByGuid = new Map()

/** @type {Set<() => void>} */
const listeners = new Set()

/** @param {() => void} fn @returns {() => void} */
export function subscribePulsePlayState (fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notify () {
  for (const fn of listeners) fn()
}

/** Drop local pulse hints (e.g. after reconnect without snapshot). */
export function resetPulsePlayState () {
  if (runningSetupGuids.size === 0 && !focusedSetupGuid && slotStateByGuid.size === 0) {
    return
  }
  runningSetupGuids.clear()
  focusedSetupGuid = null
  slotStateByGuid.clear()
  notify()
}

/**
 * @param {unknown} payload hub `hub:status` payload.
 */
export function applyHubPulseStatus (payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return
  const p = /** @type {Record<string, unknown>} */ (payload)
  if (p.kind !== 'pulse') return
  const guid = typeof p.setupGuid === 'string' ? p.setupGuid : ''
  if (!guid) return
  const status = typeof p.status === 'string' ? p.status : ''
  if (status === 'started') {
    runningSetupGuids.add(guid)
    focusedSetupGuid = guid
  } else if (status === 'stopped') {
    runningSetupGuids.delete(guid)
    slotStateByGuid.delete(guid)
    if (focusedSetupGuid === guid) {
      focusedSetupGuid = runningSetupGuids.values().next().value ?? null
    }
    notify()
    return
  }
  const data = p.data
  let bpm = 120
  let pulseSpeed = 1
  let slotIdx = 0
  let slotsTotal = 0
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = /** @type {Record<string, unknown>} */ (data)
    if (typeof d.bpm === 'number' && Number.isFinite(d.bpm)) bpm = d.bpm
    if (typeof d.speed === 'number' && Number.isFinite(d.speed)) {
      pulseSpeed = d.speed
    }
    if (typeof d.slotIdx === 'number' && Number.isFinite(d.slotIdx)) slotIdx = d.slotIdx
    if (typeof d.slotsTotal === 'number' && Number.isFinite(d.slotsTotal)) {
      slotsTotal = d.slotsTotal
    }
  }
  const msg = p.message
  let statusMessage = ''
  if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
    const text = typeof (/** @type {Record<string,unknown>} */ (msg)).text === 'string'
      ? /** @type {Record<string,unknown>} */ (msg).text
      : ''
    statusMessage = text
  }
  slotStateByGuid.set(guid, { bpm, speed: pulseSpeed, slotIdx, slotsTotal, message: statusMessage })
  notify()
}

/** @param {string} setupGuid */
export function isPulseActive (setupGuid) {
  return runningSetupGuids.has(setupGuid)
}

/** @returns {string | null} */
export function getActivePulseSetupGuid () {
  if (focusedSetupGuid && runningSetupGuids.has(focusedSetupGuid)) {
    return focusedSetupGuid
  }
  const first = runningSetupGuids.values().next().value
  return typeof first === 'string' ? first : focusedSetupGuid
}

/**
 * @param {string} setupGuid
 * @returns {{ bpm: number, speed: number, slotIdx: number, slotsTotal: number, message: string, isActive: boolean }}
 */
export function getPulseSlotStatus (setupGuid) {
  const isActive = isPulseActive(setupGuid)
  const stored = slotStateByGuid.get(setupGuid)
  return {
    bpm: stored?.bpm ?? 120,
    speed: stored?.speed ?? 1,
    slotIdx: isActive ? (stored?.slotIdx ?? 0) : 0,
    slotsTotal: isActive ? (stored?.slotsTotal ?? 0) : 0,
    message: isActive ? (stored?.message ?? '') : '',
    isActive
  }
}
