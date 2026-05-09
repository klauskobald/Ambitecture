import { registerAssignmentClass } from '../assignmentRegistry.js'
import { createLearnFieldRow } from '../components/learnFieldRow.js'
import { noteAsString, parseNoteInput } from '../midiNote.js'

const CLASS_ID = 'noteAndControl'

/**
 * @param {Record<string, unknown>} a
 */
function ensureNoteAndControlShape (a) {
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
  if (typeof p.controllerAdd !== 'number' || !Number.isFinite(p.controllerAdd)) {
    p.controllerAdd = 0
  }
  if (typeof p.controllerScale !== 'number' || !Number.isFinite(p.controllerScale)) {
    p.controllerScale = 1
  }
  if (typeof a.channel !== 'number' || !Number.isFinite(a.channel)) a.channel = 0
  a.channel = Math.max(0, Math.min(15, Math.round(a.channel)))
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
  let intentGuid = context.filterIntentGuid
  if (!intentGuid && context.intents.length > 0) {
    intentGuid = context.intents[0].guid
  }
  const targets =
    intentGuid && typeof intentGuid === 'string'
      ? [
          {
            type: 'intent',
            guid: intentGuid,
            key: 'xyY.x',
            function: 'linear'
          }
        ]
      : []
  return {
    class: CLASS_ID,
    guid,
    channel: 0,
    params: {
      note: 0,
      velocityRange: [0, 127],
      controller: 1,
      controllerAdd: 0,
      controllerScale: 1
    },
    targets
  }
}

/**
 * @typedef {{
 *   getAssignment: () => Record<string, unknown>,
 *   intents: import('../assignSession.js').IntentRow[],
 *   requestLearn: (o: { field: string, capture: 'noteOn' | 'controlChange' }) => void,
 *   onChange: () => void
 * }} NoteAndControlEditorApi
 */

/**
 * @param {HTMLElement} container
 * @param {NoteAndControlEditorApi} api
 */
function mountNoteAndControlEditor (container, api) {
  const a = api.getAssignment()
  ensureNoteAndControlShape(a)
  const p = /** @type {Record<string, unknown>} */ (a.params)

  const frag = document.createDocumentFragment()

  if (api.intents.length === 0) {
    const warn = document.createElement('p')
    warn.className = 'modal__hint modal__hint--warn'
    warn.textContent =
      'No intents in project — add targets in the project graph or load a project on the hub.'
    frag.appendChild(warn)
  }

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
    requestLearn: ({ field, capture }) =>
      api.requestLearn({ field, capture }),
    onLearnArmed: armed => noteRow.setLearnArmed(armed)
  })
  frag.appendChild(noteRow.row)

  const velWrap = document.createElement('div')
  velWrap.className = 'modal__row modal__row--velocity'
  const velLabel = document.createElement('span')
  velLabel.className = 'modal__row-label'
  velLabel.textContent = 'Velocity:'
  const lo = document.createElement('input')
  lo.type = 'number'
  lo.className = 'modal__input-num modal__input-num--vel'
  lo.min = '0'
  lo.max = '127'
  lo.value = String(/** @type {number[]} */ (p.velocityRange)[0])
  const dash = document.createElement('span')
  dash.className = 'modal__dash'
  dash.textContent = '–'
  const hi = document.createElement('input')
  hi.type = 'number'
  hi.className = 'modal__input-num modal__input-num--vel'
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
  frag.appendChild(velWrap)

  const ctrlStr = () => String(Math.round(Number(p.controller) || 0))
  const ctrlRow = createLearnFieldRow({
    field: 'controller',
    capture: 'controlChange',
    maxLen: 4,
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
    requestLearn: ({ field, capture }) =>
      api.requestLearn({ field, capture }),
    onLearnArmed: armed => ctrlRow.setLearnArmed(armed)
  })
  frag.appendChild(ctrlRow.row)

  const addScale = document.createElement('div')
  addScale.className = 'modal__row modal__row--tight'
  const addIn = document.createElement('input')
  addIn.type = 'number'
  addIn.className = 'modal__input-num modal__input-num--5'
  addIn.step = 'any'
  addIn.title = 'controllerAdd'
  addIn.setAttribute('aria-label', 'controllerAdd')
  addIn.value = String(p.controllerAdd)
  addIn.addEventListener('change', () => {
    const n = Number(addIn.value)
    p.controllerAdd = Number.isFinite(n) ? n : 0
    api.onChange()
  })
  const scaleIn = document.createElement('input')
  scaleIn.type = 'number'
  scaleIn.className = 'modal__input-num modal__input-num--5'
  scaleIn.step = 'any'
  scaleIn.title = 'controllerScale'
  scaleIn.setAttribute('aria-label', 'controllerScale')
  scaleIn.value = String(p.controllerScale)
  scaleIn.addEventListener('change', () => {
    const n = Number(scaleIn.value)
    p.controllerScale = Number.isFinite(n) ? n : 1
    api.onChange()
  })
  addScale.appendChild(addIn)
  addScale.appendChild(scaleIn)
  frag.appendChild(addScale)

  container.appendChild(frag)

  function syncFromModel () {
    ensureNoteAndControlShape(api.getAssignment())
    noteRow.syncInput()
    ctrlRow.syncInput()
    lo.value = String(/** @type {number[]} */ (p.velocityRange)[0])
    hi.value = String(/** @type {number[]} */ (p.velocityRange)[1])
    addIn.value = String(p.controllerAdd)
    scaleIn.value = String(p.controllerScale)
    noteRow.setLearnArmed(false)
    ctrlRow.setLearnArmed(false)
  }

  return {
    teardown: () => {
      container.replaceChildren()
    },
    syncFromModel
  }
}

const def = {
  id: CLASS_ID,
  label: 'Note + control',
  createDefault: createDefaultNoteAndControl,
  mountEditor: mountNoteAndControlEditor
}

registerAssignmentClass(def)

export { CLASS_ID as NOTE_AND_CONTROL_CLASS, def as noteAndControlClass }
