/**
 * Mount intent (dot-key + curve) or action (picker) target row for assign editors.
 */

import {
  readDotKeyFromMount,
  renderIntentDotKeyControl,
  setDotKeyMountDisabled
} from './intentDotKeyControl.js'
import {
  ACTION_TARGET_KEY,
  DEFAULT_DOT_KEY,
  ensureSingleTarget,
  formatActionOptionLabel,
  normalizeDotKey,
  resolveEditorTargetKind
} from './targetHelpers.js'

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
 * @param {HTMLElement} host
 * prepend target row into host (as first child fragment content caller appends)
 * @param {{
 *   getAssignment: () => Record<string, unknown>,
 *   intents: import('./targetHelpers.js').IntentRow[],
 *   actions: import('./targetHelpers.js').ActionRow[],
 *   filterGuid: string | null,
 *   systemCapabilities: unknown,
 *   getIntentClass: (guid: string) => string | null,
 *   onChange: () => void
 * }} api
 * @returns {{ row: HTMLElement, syncFromModel: () => void, teardown: () => void }}
 */
export function mountTargetEditor (host, api) {
  const a = api.getAssignment()
  const ctx = {
    filterGuid: api.filterGuid,
    intents: api.intents,
    actions: api.actions
  }
  const kind = resolveEditorTargetKind(a, ctx)
  ensureSingleTarget(a, kind)

  if (kind === 'action') {
    return mountActionTarget(host, api)
  }
  return mountIntentTarget(host, api)
}

/**
 * @param {HTMLElement} host
 * @param {{
 *   getAssignment: () => Record<string, unknown>,
 *   actions: import('./targetHelpers.js').ActionRow[],
 *   onChange: () => void
 * }} api
 */
function mountActionTarget (host, api) {
  const a = api.getAssignment()
  ensureSingleTarget(a, 'action')

  const row = document.createElement('div')
  row.className = 'modal__row modal__row--target-line'

  if (api.actions.length === 0) {
    const warn = document.createElement('p')
    warn.className = 'modal__hint modal__hint--warn'
    warn.textContent =
      'No actions in project — capture a snapshot or assign a scene/perform action first.'
    host.appendChild(warn)
  }

  const actionSel = document.createElement('select')
  actionSel.className = 'modal__select modal__select--intent-10'
  actionSel.setAttribute('aria-label', 'Action')
  actionSel.disabled = api.actions.length === 0
  const optNone = document.createElement('option')
  optNone.value = ''
  optNone.textContent = '—'
  actionSel.appendChild(optNone)
  for (const act of api.actions) {
    const opt = document.createElement('option')
    opt.value = act.guid
    opt.textContent = formatActionOptionLabel(act)
    actionSel.appendChild(opt)
  }

  function syncFromModel () {
    ensureSingleTarget(a, 'action')
    const t0 = /** @type {unknown[]} */ (a.targets)[0]
    const guid =
      t0 && typeof t0 === 'object' && !Array.isArray(t0)
        ? /** @type {Record<string, unknown>} */ (t0).guid
        : ''
    const g = typeof guid === 'string' ? guid : ''
    actionSel.value =
      g && [...actionSel.options].some(o => o.value === g) ? g : ''
  }

  actionSel.addEventListener('change', () => {
    const guid = actionSel.value
    if (!guid) {
      a.targets = []
      api.onChange()
      return
    }
    a.targets = [
      {
        type: 'action',
        guid,
        key: ACTION_TARGET_KEY,
        function: 'linear'
      }
    ]
    api.onChange()
  })

  syncFromModel()
  row.appendChild(actionSel)
  host.appendChild(row)

  return {
    row,
    syncFromModel,
    teardown: () => {}
  }
}

/**
 * @param {HTMLElement} host
 * @param {{
 *   getAssignment: () => Record<string, unknown>,
 *   intents: import('./targetHelpers.js').IntentRow[],
 *   systemCapabilities: unknown,
 *   getIntentClass: (guid: string) => string | null,
 *   onChange: () => void
 * }} api
 */
function mountIntentTarget (host, api) {
  const a = api.getAssignment()
  ensureSingleTarget(a, 'intent')

  if (api.intents.length === 0) {
    const warn = document.createElement('p')
    warn.className = 'modal__hint modal__hint--warn'
    warn.textContent =
      'No intents in project — add targets in YAML or open surface with a loaded project.'
    host.appendChild(warn)
  }

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
    ensureSingleTarget(a, 'intent')
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
    ensureSingleTarget(a, 'intent')
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

  function syncFromModel () {
    syncIntentSelect()
    const t0 = getTarget0()
    const fn =
      t0 && typeof t0.function === 'string' ? t0.function : 'linear'
    fnSel.value = FN_CURVE_IDS.includes(fn) ? fn : 'linear'
    renderKeyUi()
    setTargetFieldsDisabled(!intentSel.value)
  }

  syncFromModel()

  targetRow.appendChild(intentSel)
  targetRow.appendChild(keyLabel)
  targetRow.appendChild(keyMount)
  targetRow.appendChild(fnSel)
  host.appendChild(targetRow)

  return {
    row: targetRow,
    syncFromModel,
    teardown: () => {}
  }
}
