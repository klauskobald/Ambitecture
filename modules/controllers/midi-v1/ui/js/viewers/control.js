import { registerAssignmentClass } from '../assignmentRegistry.js'
import { createLearnFieldRow } from '../components/learnFieldRow.js'
import { mountTargetEditor } from '../mountTargetEditor.js'
import {
  defaultTargetsFromContext,
  ensureSingleTarget,
  resolveEditorTargetKind
} from '../targetHelpers.js'

const CLASS_ID = 'control'

/**
 * @param {Record<string, unknown>} a
 * @param {import('../targetHelpers.js').EditorContext} [context]
 */
function ensureControlShape (a, context) {
  if (!a.params || typeof a.params !== 'object' || Array.isArray(a.params)) {
    a.params = {}
  }
  const p = /** @type {Record<string, unknown>} */ (a.params)
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
export function createDefaultControl (context) {
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
 * }} ControlEditorApi
 */

/**
 * @param {HTMLElement} container
 * @param {ControlEditorApi} api
 */
function mountControlEditor (container, api) {
  const a = api.getAssignment()
  const ctx = {
    filterGuid: api.filterGuid,
    intents: api.intents,
    actions: api.actions
  }
  ensureControlShape(a, ctx)
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
  const row = document.createElement('div')
  row.className = 'modal__row modal__row--compact'
  const ctrlLabel = document.createElement('span')
  ctrlLabel.className = 'modal__field-label'
  ctrlLabel.textContent = 'Ctrl:'
  row.appendChild(ctrlLabel)

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
  row.appendChild(ctrlRow.row)

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
  row.appendChild(addWrap)
  frag.appendChild(row)

  container.appendChild(frag)

  function syncFromModel () {
    ensureControlShape(api.getAssignment(), ctx)
    targetUi.syncFromModel()
    ctrlRow.syncInput()
    addIn.value = String(p.controllerAdd)
    scaleIn.value = String(p.controllerScale)
  }

  return {
    teardown: () => {
      targetUi.teardown()
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
function formatActivityControl (assignment, input, result) {
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
  label: 'Control',
  createDefault: createDefaultControl,
  mountEditor: mountControlEditor,
  formatActivity: formatActivityControl
}

registerAssignmentClass(def)

export { CLASS_ID as CONTROL_CLASS, def as controlClass }
