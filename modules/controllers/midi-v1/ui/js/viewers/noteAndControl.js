import { registerAssignmentClass } from '../assignmentRegistry.js'
import { createLearnFieldRow } from '../components/learnFieldRow.js'
import { noteAsString, parseNoteInput } from '../midiNote.js'
import { mountTargetEditor } from '../mountTargetEditor.js'
import {
  defaultTargetsFromContext,
  ensureSingleTarget,
  resolveEditorTargetKind
} from '../targetHelpers.js'

const CLASS_ID = 'noteAndControl'

/**
 * @param {Record<string, unknown>} a
 * @param {import('../targetHelpers.js').EditorContext} [context]
 */
function ensureNoteAndControlShape (a, context) {
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
  if (typeof p.controller !== 'number' || !Number.isFinite(p.controller)) {
    p.controller = 1
  } else {
    p.controller = Math.max(0, Math.min(127, Math.round(p.controller)))
  }
  if (
    typeof p.controllerAdd !== 'number' ||
    !Number.isFinite(p.controllerAdd)
  ) {
    p.controllerAdd = 0
  }
  if (
    typeof p.controllerScale !== 'number' ||
    !Number.isFinite(p.controllerScale)
  ) {
    p.controllerScale = 1
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
export function createDefaultNoteAndControl (context) {
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
      controller: 1,
      controllerAdd: 0,
      controllerScale: 1
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
 * }} NoteAndControlEditorApi
 */

/**
 * @param {HTMLElement} container
 * @param {NoteAndControlEditorApi} api
 */
function mountNoteAndControlEditor (container, api) {
  const a = api.getAssignment()
  const ctx = {
    filterGuid: api.filterGuid,
    intents: api.intents,
    actions: api.actions
  }
  ensureNoteAndControlShape(a, ctx)
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
  const ctrlLabel = document.createElement('span')
  ctrlLabel.className = 'modal__field-label'
  ctrlLabel.textContent = 'Ctrl:'
  row2.appendChild(ctrlLabel)

  const ctrlStr = () => String(Math.round(Number(p.controller) || 0))
  const ctrlRow = createLearnFieldRow({
    field: 'controller',
    capture: 'controlChange',
    maxLen: 3,
    inputMode: 'numeric',
    getValue: ctrlStr,
    setValue: s => {
      const n = Math.round(Number(s))
      if (Number.isFinite(n)) p.controller = Math.max(0, Math.min(127, n))
    },
    commit: () => {
      const n = Math.round(Number(ctrlRow.input.value))
      if (Number.isFinite(n)) p.controller = Math.max(0, Math.min(127, n))
      ctrlRow.syncInput()
      api.onChange()
    },
    learn: api.learn
  })
  row2.appendChild(ctrlRow.row)

  const addWrap = document.createElement('div')
  addWrap.className = 'modal__add-scale'
  const addLabel = document.createElement('span')
  addLabel.textContent = 'Add:'
  const addIn = document.createElement('input')
  addIn.type = 'number'
  addIn.className = 'modal__input-num modal__input-num--3'
  addIn.step = 'any'
  addIn.title = 'add'
  addIn.value = String(p.controllerAdd)
  addIn.addEventListener('change', () => {
    const n = Number(addIn.value)
    p.controllerAdd = Number.isFinite(n) ? n : 0
    api.onChange()
  })
  const scaleLabel = document.createElement('span')
  scaleLabel.textContent = 'Scale:'
  const scaleIn = document.createElement('input')
  scaleIn.type = 'number'
  scaleIn.className = 'modal__input-num modal__input-num--3'
  scaleIn.step = 'any'
  scaleIn.title = 'scale'
  scaleIn.value = String(p.controllerScale)
  scaleIn.addEventListener('change', () => {
    const n = Number(scaleIn.value)
    p.controllerScale = Number.isFinite(n) ? n : 1
    api.onChange()
  })
  addWrap.appendChild(addLabel)
  addWrap.appendChild(addIn)
  addWrap.appendChild(scaleLabel)
  addWrap.appendChild(scaleIn)
  row2.appendChild(addWrap)
  frag.appendChild(row2)

  container.appendChild(frag)

  function syncFromModel () {
    ensureNoteAndControlShape(api.getAssignment(), ctx)
    targetUi.syncFromModel()
    noteRow.syncInput()
    ctrlRow.syncInput()
    lo.value = String(/** @type {number[]} */ (p.velocityRange)[0])
    hi.value = String(/** @type {number[]} */ (p.velocityRange)[1])
    addIn.value = String(p.controllerAdd)
    scaleIn.value = String(p.controllerScale)
  }

  return {
    teardown: () => {
      targetUi.teardown()
      noteRow.dispose()
      ctrlRow.dispose()
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
 * Compact live activity line, e.g. "64 ctrl 1 ⮕ 64". `input` is the raw CC
 * value (0..127); `result` is the transformed value `(cc + add) * scale`
 * before the 0..1 normalization. Add/scale are appended only when not at
 * their defaults so the line stays short.
 *
 * @param {Record<string, unknown>} assignment
 * @param {number | null} input
 * @param {number | null} result
 * @returns {string}
 */
function formatActivityNoteAndControl (assignment, input, result) {
  const p =
    assignment.params && typeof assignment.params === 'object' && !Array.isArray(assignment.params)
      ? /** @type {Record<string, unknown>} */ (assignment.params)
      : {}
  const ctrl = typeof p.controller === 'number' ? p.controller : 0
  const add = typeof p.controllerAdd === 'number' ? p.controllerAdd : 0
  const sc = typeof p.controllerScale === 'number' ? p.controllerScale : 1
  let mid = `ctrl ${ctrl}`
  if (add !== 0) mid += add > 0 ? ` +${fmtNum(add)}` : ` ${fmtNum(add)}`
  if (sc !== 1) mid += ` ×${fmtNum(sc)}`
  const inStr = input !== null ? fmtNum(input) : '—'
  const outStr = result !== null ? fmtNum(result) : '—'
  return `${inStr} ${mid} ⮕ ${outStr}`
}

const def = {
  id: CLASS_ID,
  label: 'Note + control',
  createDefault: createDefaultNoteAndControl,
  mountEditor: mountNoteAndControlEditor,
  formatActivity: formatActivityNoteAndControl
}

registerAssignmentClass(def)

export { CLASS_ID as NOTE_AND_CONTROL_CLASS, def as noteAndControlClass }
