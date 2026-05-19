/**
 * Tracks active pulse setup and slot position from hub `hub:status` (kind === 'pulse').
 * Used by Perform → Pulse list UI.
 */

/** @type {string | null} */
let activeSetupGuid = null

/** @type {boolean} */
let isRunning = false

/** @type {number} */
let bpm = 120

/** @type {number} */
let pulseSpeed = 1

/** @type {number} */
let slotIdx = 0

/** @type {number} */
let slotsTotal = 0

/** @type {string} */
let statusMessage = ''

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
  if (!activeSetupGuid && !isRunning && statusMessage === '') return
  activeSetupGuid = null
  isRunning = false
  bpm = 120
  pulseSpeed = 1
  slotIdx = 0
  slotsTotal = 0
  statusMessage = ''
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
  activeSetupGuid = guid
  isRunning = status === 'started'
  const data = p.data
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = /** @type {Record<string, unknown>} */ (data)
    if (typeof d.bpm === 'number' && Number.isFinite(d.bpm)) bpm = d.bpm
    if (typeof d.speed === 'number' && Number.isFinite(d.speed)) {
      pulseSpeed = d.speed
    } else {
      pulseSpeed = 1
    }
    if (typeof d.slotIdx === 'number' && Number.isFinite(d.slotIdx)) slotIdx = d.slotIdx
    if (typeof d.slotsTotal === 'number' && Number.isFinite(d.slotsTotal)) {
      slotsTotal = d.slotsTotal
    }
  }
  const msg = p.message
  if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
    const text = typeof (/** @type {Record<string,unknown>} */ (msg)).text === 'string'
      ? /** @type {Record<string,unknown>} */ (msg).text
      : ''
    statusMessage = text
  }
  notify()
}

/** @param {string} setupGuid */
export function isPulseActive (setupGuid) {
  return isRunning && activeSetupGuid === setupGuid
}

/** @returns {string | null} */
export function getActivePulseSetupGuid () {
  return activeSetupGuid
}

/**
 * @param {string} setupGuid
 * @returns {{ bpm: number, speed: number, slotIdx: number, slotsTotal: number, message: string, isActive: boolean }}
 */
export function getPulseSlotStatus (setupGuid) {
  const isActive = isPulseActive(setupGuid)
  return {
    bpm,
    speed: pulseSpeed,
    slotIdx: isActive ? slotIdx : 0,
    slotsTotal: isActive ? slotsTotal : 0,
    message: isActive ? statusMessage : '',
    isActive
  }
}
