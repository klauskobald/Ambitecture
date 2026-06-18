import { registerAssignmentClass } from '../assignmentRegistry.js'
import { createLearnFieldRow } from '../components/learnFieldRow.js'
import {
  readDotKeyFromMount,
  renderIntentDotKeyControl,
  setDotKeyMountDisabled
} from '../intentDotKeyControl.js'
import { noteAsString, parseNoteInput } from '../midiNote.js'
import { mountEnvArRow } from './env_ar.js'

const CLASS_ID = 'noteOnOffToggle'
const DEFAULT_DOT_KEY = 'xyy.x'

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeDotKey (raw) {
  if (typeof raw !== 'string') return ''
  return raw.trim()
}

const FN_CURVE_IDS = [
  'linear',
  'quadratic',
  'cubic',
  'sqrt',
  'smoothstep',
  'hard'
]

/**
 * @param {Record<string, unknown>} a
 */
function ensureSingleIntentTarget (a) {
  const raw = a.targets
  if (!Array.isArray(raw)) {
    a.targets = []
    return
  }
  const intentRows = []
  for (const t of raw) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) continue
    const rec = /** @type {Record<string, unknown>} */ (t)
    if (rec.type !== 'intent') continue
    const guid = rec.guid
    if (typeof guid !== 'string' || !guid) continue
    const key =
      normalizeDotKey(typeof rec.key === 'string' ? rec.key : '') ||
      DEFAULT_DOT_KEY
    const fn =
      typeof rec.function === 'string' && rec.function ? rec.function : 'linear'
    intentRows.push({ type: 'intent', guid, key, function: fn })
  }
  a.targets = intentRows.length > 0 ? [intentRows[0]] : []
}

/**
 * @param {Record<string, unknown>} a
 */
function ensureNoteOnOffToggleShape (a) {
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
  ensureSingleIntentTarget(a)
}

/**
 * @param {import('../assignSession.js').EditorContext} context
 * @returns {Record<string, unknown>}
 */
export function createDefaultNoteOnOffToggle (context) {
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
            key: DEFAULT_DOT_KEY,
            function: 'linear'
          }
        ]
      : []
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
        enabled: true,
        attackMs: 0,
        releaseMs: 0
      }
    },
    targets
  }
}

/**
 * @typedef {{
 *   getAssignment: () => Record<string, unknown>,
 *   intents: import('../assignSession.js').IntentRow[],
 *   systemCapabilities: unknown,
 *   getIntentClass: (guid: string) => string | null,
 *   requestLearn: (o: { field: string, capture: 'noteOn' | 'controlChange' }) => void,
 *   onChange: () => void
 * }} NoteOnOffToggleEditorApi
 */

/**
 * @param {HTMLElement} container
 * @param {NoteOnOffToggleEditorApi} api
 */
function mountNoteOnOffToggleEditor (container, api) {
  const a = api.getAssignment()
  ensureNoteOnOffToggleShape(a)
  const p = /** @type {Record<string, unknown>} */ (a.params)

  const frag = document.createDocumentFragment()

  if (api.intents.length === 0) {
    const warn = document.createElement('p')
    warn.className = 'modal__hint modal__hint--warn'
    warn.textContent =
      'No intents in project — add targets in YAML or open surface with a loaded project.'
    frag.appendChild(warn)
  }

  const hint = document.createElement('p')
  hint.className = 'modal__hint'
  hint.textContent =
    'Tap toggles on/off; release does not turn off. Same velocity and envelope rules as Note on/off.'
  frag.appendChild(hint)

  const targetRow = document.createElement('div')
  targetRow.className = 'modal__row modal__row--target-line'

  const intentSel = document.createElement('select')
  intentSel.className = 'modal__select modal__select--intent-10'
  intentSel.setAttribute('aria-label', 'Intent')
  intentSel.disabled = api.intents.length === 0
  const optNone = document.createElement('option')
  optNone.value = ''
  optNone.textContent = '—'
  intentSel.appendChild(optNone)
  for (const it of api.intents) {
    const opt = document.createElement('option')
    opt.value = it.guid
    opt.textContent = it.name
    intentSel.appendChild(opt)
  }

  function getTarget0 () {
    ensureNoteOnOffToggleShape(a)
    const t = /** @type {unknown[]} */ (a.targets)[0]
    return t && typeof t === 'object' && !Array.isArray(t)
      ? /** @type {Record<string, unknown>} */ (t)
      : null
  }

  function syncIntentSelect () {
    const t0 = getTarget0()
    const guid = t0 && typeof t0.guid === 'string' ? t0.guid : ''
    intentSel.value =
      guid && [...intentSel.options].some(o => o.value === guid) ? guid : ''
  }

  const t0Init = getTarget0()

  const keyLabel = document.createElement('span')
  keyLabel.className = 'modal__field-label'
  keyLabel.textContent = 'key:'

  const keyMount = document.createElement('span')
  keyMount.className = 'modal__dot-key-mount'

  const fnSel = document.createElement('select')
  fnSel.className = 'modal__select modal__select--fn8'
  fnSel.setAttribute('aria-label', 'Curve function')
  for (const id of FN_CURVE_IDS) {
    const opt = document.createElement('option')
    opt.value = id
    opt.textContent = id
    fnSel.appendChild(opt)
  }
  const fnInit =
    t0Init && typeof t0Init.function === 'string' ? t0Init.function : 'linear'
  fnSel.value = FN_CURVE_IDS.includes(fnInit) ? fnInit : 'linear'

  function setTargetFieldsDisabled (disabled) {
    setDotKeyMountDisabled(keyMount, disabled)
    fnSel.disabled = disabled
  }

  function renderKeyUi () {
    ensureNoteOnOffToggleShape(a)
    const t0 = getTarget0()
    const cur =
      normalizeDotKey(t0 && typeof t0.key === 'string' ? t0.key : '') ||
      DEFAULT_DOT_KEY
    const ig = intentSel.value
    renderIntentDotKeyControl(keyMount, {
      intentGuid: ig,
      getIntentClass: guid => api.getIntentClass(guid),
      systemCapabilities: api.systemCapabilities,
      currentKey: cur,
      defaultDotKey: DEFAULT_DOT_KEY,
      normalizeDotKey,
      disabled: !ig,
      onCommit: commitTarget
    })
  }

  function commitTarget () {
    const guid = intentSel.value
    if (!guid) {
      a.targets = []
      setTargetFieldsDisabled(true)
      renderKeyUi()
      api.onChange()
      return
    }
    setTargetFieldsDisabled(false)
    let keyStr = readDotKeyFromMount(keyMount, normalizeDotKey, DEFAULT_DOT_KEY)
    if (!keyStr) keyStr = DEFAULT_DOT_KEY
    let fn = fnSel.value
    if (!FN_CURVE_IDS.includes(fn)) fn = 'linear'
    a.targets = [
      {
        type: 'intent',
        guid,
        key: keyStr,
        function: fn
      }
    ]
    api.onChange()
  }

  fnSel.addEventListener('change', commitTarget)
  intentSel.addEventListener('change', () => {
    commitTarget()
    renderKeyUi()
  })

  syncIntentSelect()
  renderKeyUi()
  setTargetFieldsDisabled(!intentSel.value)

  targetRow.appendChild(intentSel)
  targetRow.appendChild(keyLabel)
  targetRow.appendChild(keyMount)
  targetRow.appendChild(fnSel)
  frag.appendChild(targetRow)

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
    requestLearn: ({ field, capture }) => api.requestLearn({ field, capture }),
    onLearnArmed: armed => noteRow.setLearnArmed(armed)
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

  const envUi = mountEnvArRow(frag, {
    getParams: () => {
      const asg = api.getAssignment()
      ensureNoteOnOffToggleShape(asg)
      return /** @type {Record<string, unknown>} */ (asg.params)
    },
    onChange: () => api.onChange()
  })

  container.appendChild(frag)

  function syncFromModel () {
    ensureNoteOnOffToggleShape(api.getAssignment())
    syncIntentSelect()
    renderKeyUi()
    setTargetFieldsDisabled(!intentSel.value)
    const t0 = getTarget0()
    const fn = t0 && typeof t0.function === 'string' ? t0.function : 'linear'
    fnSel.value = FN_CURVE_IDS.includes(fn) ? fn : 'linear'
    noteRow.syncInput()
    lo.value = String(/** @type {number[]} */ (p.velocityRange)[0])
    hi.value = String(/** @type {number[]} */ (p.velocityRange)[1])
    offIn.value = String(p.velocityOffset)
    scaleIn.value = String(p.velocityScale)
    noteRow.setLearnArmed(false)
    envUi.syncFromModel()
  }

  return {
    teardown: () => {
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
 * @param {Record<string, unknown>} assignment
 * @param {number | null} input
 * @param {number | null} result
 * @returns {string}
 */
function formatActivityNoteOnOffToggle (assignment, input, result) {
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
  label: 'Note on/off toggle',
  createDefault: createDefaultNoteOnOffToggle,
  mountEditor: mountNoteOnOffToggleEditor,
  formatActivity: formatActivityNoteOnOffToggle
}

registerAssignmentClass(def)

export { CLASS_ID as NOTE_ON_OFF_TOGGLE_CLASS, def as noteOnOffToggleClass }
