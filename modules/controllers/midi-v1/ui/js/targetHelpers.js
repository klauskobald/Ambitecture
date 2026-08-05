/**
 * Shared MIDI assignment target helpers (intent param vs one-shot action).
 */

export const ACTION_TARGET_KEY = 'trigger'
export const DEFAULT_DOT_KEY = 'xyy.x'
export const NOTE_AND_CONTROL_CLASS = 'noteAndControl'

/**
 * @typedef {{ guid: string, name: string }} IntentRow
 * @typedef {{ guid: string, name: string, executeType: string }} ActionRow
 * @typedef {{
 *   filterGuid: string | null,
 *   intents: IntentRow[],
 *   actions: ActionRow[]
 * }} EditorContext
 */

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizeDotKey (raw) {
  if (typeof raw !== 'string') return ''
  return raw.trim().toLowerCase()
}

/**
 * @param {EditorContext} context
 * @returns {boolean}
 */
export function filterIsAction (context) {
  const g = context.filterGuid
  if (!g) return false
  return context.actions.some(a => a.guid === g)
}

/**
 * @param {Record<string, unknown>} a
 * @returns {'action' | 'intent' | null}
 */
export function getPrimaryTargetKind (a) {
  const raw = a.targets
  if (!Array.isArray(raw) || raw.length === 0) return null
  const t0 = raw[0]
  if (!t0 || typeof t0 !== 'object' || Array.isArray(t0)) return null
  const type = /** @type {Record<string, unknown>} */ (t0).type
  if (type === 'action') return 'action'
  if (type === 'intent') return 'intent'
  return null
}

/**
 * Prefer existing target kind; else filter GUID kind; else intent.
 * @param {Record<string, unknown>} a
 * @param {EditorContext} context
 * @returns {'action' | 'intent'}
 */
export function resolveEditorTargetKind (a, context) {
  const existing = getPrimaryTargetKind(a)
  if (existing) return existing
  if (filterIsAction(context)) return 'action'
  return 'intent'
}

/**
 * @param {EditorContext} context
 * @returns {Record<string, unknown>[]}
 */
export function defaultTargetsFromContext (context) {
  if (filterIsAction(context) && context.filterGuid) {
    return [
      {
        type: 'action',
        guid: context.filterGuid,
        key: ACTION_TARGET_KEY,
        function: 'linear'
      }
    ]
  }
  let intentGuid = context.filterGuid
  if (!intentGuid && context.intents.length > 0) {
    intentGuid = context.intents[0].guid
  }
  if (intentGuid && typeof intentGuid === 'string') {
    return [
      {
        type: 'intent',
        guid: intentGuid,
        key: DEFAULT_DOT_KEY,
        function: 'linear'
      }
    ]
  }
  if (context.actions.length > 0) {
    const first = context.actions[0]
    return [
      {
        type: 'action',
        guid: first.guid,
        key: ACTION_TARGET_KEY,
        function: 'linear'
      }
    ]
  }
  return []
}

/**
 * Action targets never use AR envelope — clear enabled when entering that lifecycle.
 * @param {Record<string, unknown>} a
 */
export function disableEnvelope (a) {
  const p = a.params
  if (!p || typeof p !== 'object' || Array.isArray(p)) return
  const e = /** @type {Record<string, unknown>} */ (p).envelope
  if (!e || typeof e !== 'object' || Array.isArray(e)) return
  /** @type {Record<string, unknown>} */ (e).enabled = false
}

/**
 * Keep at most one intent or action target.
 * @param {Record<string, unknown>} a
 * @param {'intent' | 'action' | null} [preferKind]
 */
export function ensureSingleTarget (a, preferKind = null) {
  const raw = a.targets
  if (!Array.isArray(raw)) {
    a.targets = []
    return
  }
  /** @type {Record<string, unknown>[]} */
  const intentRows = []
  /** @type {Record<string, unknown>[]} */
  const actionRows = []
  for (const t of raw) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) continue
    const rec = /** @type {Record<string, unknown>} */ (t)
    const guid = rec.guid
    if (typeof guid !== 'string' || !guid) continue
    if (rec.type === 'intent') {
      const key =
        normalizeDotKey(typeof rec.key === 'string' ? rec.key : '') ||
        DEFAULT_DOT_KEY
      const fn =
        typeof rec.function === 'string' && rec.function ? rec.function : 'linear'
      intentRows.push({ type: 'intent', guid, key, function: fn })
    } else if (rec.type === 'action') {
      actionRows.push({
        type: 'action',
        guid,
        key: ACTION_TARGET_KEY,
        function: 'linear'
      })
    }
  }
  if (preferKind === 'action') {
    a.targets = actionRows.length > 0 ? [actionRows[0]] : []
    return
  }
  if (preferKind === 'intent') {
    a.targets = intentRows.length > 0 ? [intentRows[0]] : []
    return
  }
  if (actionRows.length > 0) {
    a.targets = [actionRows[0]]
    return
  }
  a.targets = intentRows.length > 0 ? [intentRows[0]] : []
}

/**
 * @param {import('./assignmentRegistry.js').AssignmentClassDef[] | { id: string, label: string }[]} classes
 * @param {'action' | 'intent'} kind
 * @param {string | null} currentClassId
 */
export function filterClassesForTargetKind (classes, kind, currentClassId) {
  let list = [...classes]
  if (kind === 'action') {
    list = list.filter(c => c.id !== NOTE_AND_CONTROL_CLASS)
  }
  if (
    currentClassId &&
    !list.some(c => c.id === currentClassId) &&
    classes.some(c => c.id === currentClassId)
  ) {
    const cur = classes.find(c => c.id === currentClassId)
    if (cur) list = [cur, ...list]
  }
  return list
}

/**
 * Preferred create class when filter targets an action (one-shot).
 * @param {EditorContext} context
 * @returns {string}
 */
export function preferredCreateClassId (context) {
  if (filterIsAction(context)) return 'noteOnOff'
  return NOTE_AND_CONTROL_CLASS
}

/**
 * Label for action picker option.
 * @param {ActionRow} row
 * @returns {string}
 */
export function formatActionOptionLabel (row) {
  let prefix = 'action'
  switch (row.executeType) {
    case 'snapshot':
      prefix = 'snap'
      break
    case 'scene':
      prefix = 'scene'
      break
    case 'animation':
      prefix = 'anim'
      break
    case 'intent':
      prefix = 'intent'
      break
    default:
      break
  }
  return `${prefix}: ${row.name}`
}
