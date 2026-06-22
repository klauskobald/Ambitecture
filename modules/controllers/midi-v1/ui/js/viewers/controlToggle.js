import { registerAssignmentClass } from '../assignmentRegistry.js'
import { createLearnFieldRow } from '../components/learnFieldRow.js'
import {
  readDotKeyFromMount,
  renderIntentDotKeyControl,
  setDotKeyMountDisabled
} from '../intentDotKeyControl.js'

const CLASS_ID = 'controlToggle'

/** Canonical lowercase dot path for new / empty targets (assign UI always lowercases keys). */
const DEFAULT_DOT_KEY = 'xyy.x'

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeDotKey (raw) {
  if (typeof raw !== 'string') return ''
  return raw.trim().toLowerCase()
}

/** Matches midi-v1 `FnCurve` registry. */
const FN_CURVE_IDS = [
  'linear',
  'quadratic',
  'cubic',
  'sqrt',
  'smoothstep',
  'hard'
]

/**
 * Keep at most one `intent` target (control UI).
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
function ensureControlToggleShape (a) {
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
  ensureSingleIntentTarget(a)
}

/**
 * @param {import('../assignSession.js').EditorContext} context
 * @returns {Record<string, unknown>}
 */
export function createDefaultControlToggle (context) {
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
 *   systemCapabilities: unknown,
 *   getIntentClass: (guid: string) => string | null,
 *   learn: import('../assignModal.js').LearnCoordinator,
 *   onChange: () => void
 * }} ControlToggleEditorApi
 */

/**
 * @param {HTMLElement} container
 * @param {ControlToggleEditorApi} api
 */
function mountControlToggleEditor (container, api) {
  const a = api.getAssignment()
  ensureControlToggleShape(a)
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
    'Each incoming CC press toggles between the received value and 0; a 0 (release) is ignored.'
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
    ensureSingleIntentTarget(a)
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
    t0Init && typeof t0Init.function === 'string'
      ? t0Init.function
      : 'linear'
  fnSel.value = FN_CURVE_IDS.includes(fnInit) ? fnInit : 'linear'

  function setTargetFieldsDisabled (disabled) {
    setDotKeyMountDisabled(keyMount, disabled)
    fnSel.disabled = disabled
  }

  function renderKeyUi () {
    ensureSingleIntentTarget(a)
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
    ensureControlToggleShape(api.getAssignment())
    syncIntentSelect()
    renderKeyUi()
    setTargetFieldsDisabled(!intentSel.value)
    const t0 = getTarget0()
    const fn =
      t0 && typeof t0.function === 'string' ? t0.function : 'linear'
    fnSel.value = FN_CURVE_IDS.includes(fn) ? fn : 'linear'
    ctrlRow.syncInput()
    addIn.value = String(p.controllerAdd)
    scaleIn.value = String(p.controllerScale)
  }

  return {
    teardown: () => {
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
 * Compact live activity line, e.g. "64 ctrl 1 toggle ⮕ 64". `input` is the raw
 * CC value (0..127); `result` is the latched output — the bias floor
 * `(add) * scale` when toggled off, else the transformed `(cc + add) * scale`.
 * Add/scale are appended only when not at their defaults so the line stays short.
 *
 * @param {Record<string, unknown>} assignment
 * @param {number | null} input
 * @param {number | null} result
 * @returns {string}
 */
function formatActivityControlToggle (assignment, input, result) {
  const p =
    assignment.params && typeof assignment.params === 'object' && !Array.isArray(assignment.params)
      ? /** @type {Record<string, unknown>} */ (assignment.params)
      : {}
  const ctrl = typeof p.controller === 'number' ? p.controller : 0
  const add = typeof p.controllerAdd === 'number' ? p.controllerAdd : 0
  const sc = typeof p.controllerScale === 'number' ? p.controllerScale : 1
  let mid = `ctrl ${ctrl} toggle`
  if (add !== 0) mid += add > 0 ? ` +${fmtNum(add)}` : ` ${fmtNum(add)}`
  if (sc !== 1) mid += ` ×${fmtNum(sc)}`
  const inStr = input !== null ? fmtNum(input) : '—'
  const outStr = result !== null ? fmtNum(result) : '—'
  return `${inStr} ${mid} ⮕ ${outStr}`
}

const def = {
  id: CLASS_ID,
  label: 'Control toggle',
  createDefault: createDefaultControlToggle,
  mountEditor: mountControlToggleEditor,
  formatActivity: formatActivityControlToggle
}

registerAssignmentClass(def)

export { CLASS_ID as CONTROL_TOGGLE_CLASS, def as controlToggleClass }
