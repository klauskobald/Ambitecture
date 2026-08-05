import { registerAssignmentClass } from '../assignmentRegistry.js'
import { createLearnFieldRow } from '../components/learnFieldRow.js'
import { noteAsString, parseNoteInput } from '../midiNote.js'
import { mountTargetEditor } from '../mountTargetEditor.js'
import {
  defaultTargetsFromContext,
  ensureSingleTarget,
  filterIsAction,
  resolveEditorTargetKind
} from '../targetHelpers.js'
import { mountEnvArRow } from './env_ar.js'

const CLASS_ID = 'noteOnOff'

/**
 * @param {Record<string, unknown>} a
 * @param {import('../targetHelpers.js').EditorContext} [context]
 */
function ensureNoteOnOffShape (a, context) {
  if (!a.params || typeof a.params !== 'object' || Array.isArray(a.params)) {
    a.params = {}
  }
  const p = /** @type {Record<string, unknown>} */ (a.params)
  if (typeof p.note !== 'number' || !Number.isFinite(p.note)) p.note = 0
  if (!Array.isArray(p.velocityRange) || p.velocityRange.length !== 2) {
    p.velocityRange = [0, 127]
  } else {
    const lo = Number(p.velocityRange[0])
    const hi = Number(p.velocityRange[1])
    p.velocityRange = [
      Number.isFinite(lo) ? Math.max(0, Math.min(127, Math.round(lo))) : 0,
      Number.isFinite(hi) ? Math.max(0, Math.min(127, Math.round(hi))) : 127
    ]
  }
  if (
    typeof p.velocityOffset !== 'number' ||
    !Number.isFinite(p.velocityOffset)
  ) {
    p.velocityOffset = 0
  }
  if (
    typeof p.velocityScale !== 'number' ||
    !Number.isFinite(p.velocityScale)
  ) {
    p.velocityScale = 1
  }
  if (p.envelope === undefined) {
    p.envelope = {
      type: 'env_ar',
      enabled: true,
      attackMs: 0,
      releaseMs: 0
    }
  } else if (p.envelope === null) {
    p.envelope = {
      type: 'env_ar',
      enabled: false,
      attackMs: 0,
      releaseMs: 0
    }
  } else if (typeof p.envelope === 'object' && !Array.isArray(p.envelope)) {
    const e = /** @type {Record<string, unknown>} */ (p.envelope)
    e.type = 'env_ar'
    if (typeof e.enabled !== 'boolean') e.enabled = true
    const atk = Number(e.attackMs)
    const rel = Number(e.releaseMs)
    e.attackMs = Number.isFinite(atk) ? Math.max(0, Math.round(atk)) : 0
    e.releaseMs = Number.isFinite(rel) ? Math.max(0, Math.round(rel)) : 0
  } else {
    p.envelope = {
      type: 'env_ar',
      enabled: true,
      attackMs: 0,
      releaseMs: 0
    }
  }
  if (typeof a.channel !== 'number' || !Number.isFinite(a.channel))
    a.channel = 0
  a.channel = Math.max(0, Math.min(16, Math.round(a.channel)))
  const kind = context
    ? resolveEditorTargetKind(a, context)
    : getPrimaryKindLoose(a)
  ensureSingleTarget(a, kind)
}

/**
 * @param {Record<string, unknown>} a
 * @returns {'action' | 'intent'}
 */
function getPrimaryKindLoose (a) {
  const raw = a.targets
  if (Array.isArray(raw) && raw[0] && typeof raw[0] === 'object') {
    const t = /** @type {Record<string, unknown>} */ (raw[0])
    if (t.type === 'action') return 'action'
  }
  return 'intent'
}

/**
 * @param {import('../assignSession.js').EditorContext} context
 * @returns {Record<string, unknown>}
 */
export function createDefaultNoteOnOff (context) {
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const guid = `asg-${suffix}`
  return {
    class: CLASS_ID,
    guid,
    channel: 0,
    channelAny: true,
    device: '',
    deviceAny: true,
    params: {
      note: 0,
      velocityRange: [0, 127],
      velocityOffset: 0,
      velocityScale: 1,
      envelope: {
        type: 'env_ar',
        enabled: !filterIsAction(context),
        attackMs: 0,
        releaseMs: 0
      }
    },
    targets: defaultTargetsFromContext(context)
  }
}

/**
 * @typedef {{
 *   getAssignment: () => Record<string, unknown>,
 *   intents: import('../assignSession.js').IntentRow[],
 *   actions: import('../assignSession.js').ActionRow[],
 *   filterGuid: string | null,
 *   systemCapabilities: unknown,
 *   getIntentClass: (guid: string) => string | null,
 *   learn: import('../assignModal.js').LearnCoordinator,
 *   onChange: () => void
 * }} NoteOnOffEditorApi
 */

/**
 * @param {HTMLElement} container
 * @param {NoteOnOffEditorApi} api
 */
function mountNoteOnOffEditor (container, api) {
  const a = api.getAssignment()
  const ctx = {
    filterGuid: api.filterGuid,
    intents: api.intents,
    actions: api.actions
  }
  ensureNoteOnOffShape(a, ctx)
  const p = /** @type {Record<string, unknown>} */ (a.params)

  const targetHost = document.createElement('div')
  container.appendChild(targetHost)
  const targetUi = mountTargetEditor(targetHost, {
    getAssignment: api.getAssignment,
    intents: api.intents,
    actions: api.actions,
    filterGuid: api.filterGuid,
    systemCapabilities: api.systemCapabilities,
    getIntentClass: api.getIntentClass,
    onChange: api.onChange
  })

  const frag = document.createDocumentFragment()

  const row1 = document.createElement('div')
  row1.className = 'modal__row modal__row--compact'

  const noteLabel = document.createElement('span')
  noteLabel.className = 'modal__field-label'
  noteLabel.textContent = 'Note:'
  row1.appendChild(noteLabel)

  const noteRow = createLearnFieldRow({
    field: 'note',
    capture: 'noteOn',
    maxLen: 5,
    getValue: () => noteAsString(Number(p.note) || 0),
    setValue: s => {
      const parsed = parseNoteInput(s)
      if (parsed !== null) p.note = parsed
    },
    commit: () => {
      const parsed = parseNoteInput(noteRow.input.value)
      if (parsed !== null) p.note = parsed
      noteRow.syncInput()
      api.onChange()
    },
    learn: api.learn
  })
  row1.appendChild(noteRow.row)

  const velWrap = document.createElement('div')
  velWrap.className = 'modal__vel-wrap modal__vel-wrap--trail'
  const velLabel = document.createElement('span')
  velLabel.className = 'modal__vel-label'
  velLabel.textContent = 'Velo:'
  const lo = document.createElement('input')
  lo.type = 'number'
  lo.className = 'modal__input-num modal__input-num--2'
  lo.min = '0'
  lo.max = '127'
  lo.value = String(/** @type {number[]} */ (p.velocityRange)[0])
  const dash = document.createElement('span')
  dash.className = 'modal__dash'
  dash.textContent = '–'
  const hi = document.createElement('input')
  hi.type = 'number'
  hi.className = 'modal__input-num modal__input-num--2'
  hi.min = '0'
  hi.max = '127'
  hi.value = String(/** @type {number[]} */ (p.velocityRange)[1])
  function commitVel () {
    const a0 = Math.round(Number(lo.value))
    const a1 = Math.round(Number(hi.value))
    p.velocityRange = [
      Math.max(0, Math.min(127, Number.isFinite(a0) ? a0 : 0)),
      Math.max(0, Math.min(127, Number.isFinite(a1) ? a1 : 127))
    ]
    lo.value = String(p.velocityRange[0])
    hi.value = String(p.velocityRange[1])
    api.onChange()
  }
  lo.addEventListener('change', commitVel)
  hi.addEventListener('change', commitVel)
  velWrap.appendChild(velLabel)
  velWrap.appendChild(lo)
  velWrap.appendChild(dash)
  velWrap.appendChild(hi)
  row1.appendChild(velWrap)
  frag.appendChild(row1)

  const row2 = document.createElement('div')
  row2.className = 'modal__row modal__row--compact'
  const offLabel = document.createElement('span')
  offLabel.className = 'modal__field-label'
  offLabel.textContent = 'Off:'
  const offIn = document.createElement('input')
  offIn.type = 'number'
  offIn.className = 'modal__input-num modal__input-num--3'
  offIn.step = 'any'
  offIn.title = 'velocityOffset'
  offIn.value = String(p.velocityOffset)
  offIn.addEventListener('change', () => {
    const n = Number(offIn.value)
    p.velocityOffset = Number.isFinite(n) ? n : 0
    api.onChange()
  })
  const scaleLabel = document.createElement('span')
  scaleLabel.className = 'modal__field-label'
  scaleLabel.textContent = 'Scale:'
  const scaleIn = document.createElement('input')
  scaleIn.type = 'number'
  scaleIn.className = 'modal__input-num modal__input-num--3'
  scaleIn.step = 'any'
  scaleIn.title = 'velocityScale'
  scaleIn.value = String(p.velocityScale)
  scaleIn.addEventListener('change', () => {
    const n = Number(scaleIn.value)
    p.velocityScale = Number.isFinite(n) ? n : 1
    api.onChange()
  })
  row2.appendChild(offLabel)
  row2.appendChild(offIn)
  row2.appendChild(scaleLabel)
  row2.appendChild(scaleIn)
  frag.appendChild(row2)

  /** @type {{ syncFromModel: () => void, teardown: () => void }} */
  let envUi = { syncFromModel () {}, teardown () {} }
  if (resolveEditorTargetKind(a, ctx) !== 'action') {
    envUi = mountEnvArRow(frag, {
      getParams: () => {
        const asg = api.getAssignment()
        ensureNoteOnOffShape(asg, ctx)
        return /** @type {Record<string, unknown>} */ (asg.params)
      },
      onChange: () => api.onChange()
    })
  }

  container.appendChild(frag)

  function syncFromModel () {
    ensureNoteOnOffShape(api.getAssignment(), ctx)
    targetUi.syncFromModel()
    noteRow.syncInput()
    lo.value = String(/** @type {number[]} */ (p.velocityRange)[0])
    hi.value = String(/** @type {number[]} */ (p.velocityRange)[1])
    offIn.value = String(p.velocityOffset)
    scaleIn.value = String(p.velocityScale)
    envUi.syncFromModel()
  }

  return {
    teardown: () => {
      targetUi.teardown()
      noteRow.dispose()
      envUi.teardown()
      container.replaceChildren()
    },
    syncFromModel
  }
}

/**
 * @param {number} n
 * @returns {string}
 */
function fmtNum (n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/**
 * Compact live activity line, e.g. "100 +50×2 ⮕ 300". `input` is the incoming
 * MIDI velocity (0..127); `result` is the velocity-space value sent before
 * the 0..1 normalization (can over- or undershoot when offset/scale are set).
 *
 * @param {Record<string, unknown>} assignment
 * @param {number | null} input
 * @param {number | null} result
 * @returns {string}
 */
function formatActivityNoteOnOff (assignment, input, result) {
  const p =
    assignment.params && typeof assignment.params === 'object' && !Array.isArray(assignment.params)
      ? /** @type {Record<string, unknown>} */ (assignment.params)
      : {}
  const off = typeof p.velocityOffset === 'number' ? p.velocityOffset : 0
  const sc = typeof p.velocityScale === 'number' ? p.velocityScale : 1
  let mid = ''
  if (off !== 0) mid += off > 0 ? `+${fmtNum(off)}` : fmtNum(off)
  if (sc !== 1) mid += `×${fmtNum(sc)}`
  const inStr = input !== null ? fmtNum(input) : '—'
  const outStr = result !== null ? fmtNum(result) : '—'
  return mid ? `${inStr} ${mid} ⮕ ${outStr}` : `${inStr} ⮕ ${outStr}`
}

const def = {
  id: CLASS_ID,
  label: 'Note on/off',
  createDefault: createDefaultNoteOnOff,
  mountEditor: mountNoteOnOffEditor,
  formatActivity: formatActivityNoteOnOff
}

registerAssignmentClass(def)

export { CLASS_ID as NOTE_ON_OFF_CLASS, def as noteOnOffClass }
