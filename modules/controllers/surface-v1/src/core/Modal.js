/**
 * Dark-themed modal dialogs replacing native alert / confirm / prompt.
 *
 * Every method returns a Promise and also accepts an optional callback.
 * Only one modal is shown at a time — calling any method while a modal
 * is open dismisses the current one first.
 *
 *   Modal.alert('Something happened')
 *   Modal.warn('Check this before continuing')
 *   Modal.confirm('Delete this?', { yes: 'Delete', no: 'Cancel' }).then(ok => { ... })
 *   Modal.prompt('New scene', [
 *     { label: 'Name', key: 'name', placeholder: 'untitled' }
 *   ]).then(values => { ... })  // values is null if cancelled; string fields are trimmed
 *   pickChoice('Pick one', [
 *     { value: 'a', label: 'Option A' },
 *     { value: 'b', label: 'Option B', disabled: true, title: 'Soon' }
 *   ]).then(v => { ... })  // v is chosen value string, or null if cancelled
 *   sampleKey('Press Key', 'No Key').then(k => { ... })  // key string, '' = clear, null = cancel
 *   Modal.sampleKey(...)  // same as named export
 *   openModalCard(dismiss => { ... build card, call dismiss(result) ... }).then(...)
 */

/** @type {HTMLElement | null} */
let _overlay = null
/** @type {(() => void) | null} */
let _resolve = null

// ── DOM singleton ──────────────────────────────────────────────────────────────

function _ensureOverlay () {
  if (_overlay) return
  _overlay = document.createElement('div')
  _overlay.className = 'modal-overlay'
  _overlay.addEventListener('click', (e) => {
    if (e.target === _overlay) _dismiss(null)
  })
  document.body.appendChild(_overlay)
}

function _dismiss (value) {
  if (!_overlay) return
  _overlay.classList.remove('is-open')
  _overlay.classList.remove('modal-overlay--fullscreen')
  _overlay.innerHTML = ''
  const cb = _resolve
  _resolve = null
  cb?.(value)
}

/** Ignore lone Shift/Ctrl/Alt/etc. so sampling waits for the actual character key. */
const _MODIFIER_SAMPLE_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'AltGraph',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Fn',
  'FnLock',
  'OS',
  'Super',
  'Hyper',
  'Process'
])

/**
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
function _isModifierOnlyKeydown (e) {
  if (_MODIFIER_SAMPLE_KEYS.has(e.key)) return true
  const c = e.code
  return (
    c === 'ShiftLeft' ||
    c === 'ShiftRight' ||
    c === 'ControlLeft' ||
    c === 'ControlRight' ||
    c === 'AltLeft' ||
    c === 'AltRight' ||
    c === 'MetaLeft' ||
    c === 'MetaRight' ||
    c === 'AltGraph' ||
    c === 'ContextMenu'
  )
}

// ── Builders ───────────────────────────────────────────────────────────────────

/**
 * @param {string} text
 * @param {Array<{ label: string, key: string, type?: string, placeholder?: string, value?: string }>} fields
 * @param {{ submit?: string, cancel?: string }} [buttons]
 * @returns {HTMLElement}
 */
function _buildPrompt (text, fields, buttons) {
  const card = document.createElement('div')
  card.className = 'modal'
  card.addEventListener('click', (e) => e.stopPropagation())

  if (text) {
    const p = document.createElement('p')
    p.className = 'modal-text'
    p.textContent = text
    card.appendChild(p)
  }

  const inputs = /** @type {HTMLInputElement[]} */ ([])
  if (fields.length > 0) {
    const fieldSet = document.createElement('div')
    fieldSet.className = 'modal-fields'
    for (const f of fields) {
      const input = document.createElement('input')
      input.className = 'modal-input'
      input.type = f.type ?? 'text'
      input.placeholder = f.placeholder ?? ''
      input.value = f.value ?? ''
      input.setAttribute('data-key', f.key)
      if (f.label) input.setAttribute('aria-label', f.label)
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          _submit(inputs, fields)
        }
      })
      fieldSet.appendChild(input)
      inputs.push(input)
    }
    card.appendChild(fieldSet)
    // Auto-focus first input
    requestAnimationFrame(() => inputs[0]?.focus())
  }

  const actions = document.createElement('div')
  actions.className = 'modal-actions'

  const cancelText = buttons?.cancel ?? 'Cancel'
  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'btn'
  cancelBtn.textContent = cancelText
  cancelBtn.addEventListener('click', () => _dismiss(null))

  const submitText = buttons?.submit ?? 'OK'
  const submitBtn = document.createElement('button')
  submitBtn.className = 'btn btn--primary'
  submitBtn.textContent = submitText
  submitBtn.addEventListener('click', () => _submit(inputs, fields))

  actions.appendChild(cancelBtn)
  actions.appendChild(submitBtn)
  card.appendChild(actions)

  return card
}

/**
 * @param {HTMLInputElement[]} inputs
 * @param {Array<{ key: string }>} fields
 */
function _submit (inputs, fields) {
  /** @type {Record<string, string>} */
  const values = {}
  for (let i = 0; i < fields.length; i++) {
    values[fields[i].key] = (inputs[i]?.value ?? '').trim()
  }
  _dismiss(values)
}

/**
 * @param {string} text
 * @param {{ yes?: string, no?: string }} [buttons]
 * @returns {HTMLElement}
 */
function _buildConfirm (text, buttons) {
  const card = document.createElement('div')
  card.className = 'modal'
  card.addEventListener('click', (e) => e.stopPropagation())

  if (text) {
    const p = document.createElement('p')
    p.className = 'modal-text'
    p.textContent = text
    card.appendChild(p)
  }

  const actions = document.createElement('div')
  actions.className = 'modal-actions'

  const noText = buttons?.no ?? 'Cancel'
  const noBtn = document.createElement('button')
  noBtn.className = 'btn'
  noBtn.textContent = noText
  noBtn.addEventListener('click', () => _dismiss(false))

  const yesText = buttons?.yes ?? 'OK'
  const yesBtn = document.createElement('button')
  yesBtn.className = 'btn btn--primary'
  yesBtn.textContent = yesText
  yesBtn.addEventListener('click', () => _dismiss(true))

  actions.appendChild(noBtn)
  actions.appendChild(yesBtn)
  card.appendChild(actions)

  // Focus the yes/danger button by default
  requestAnimationFrame(() => yesBtn.focus())

  return card
}

/**
 * @param {string} text
 * @returns {HTMLElement}
 */
function _buildAlert (text) {
  const card = document.createElement('div')
  card.className = 'modal'
  card.addEventListener('click', (e) => e.stopPropagation())

  if (text) {
    const p = document.createElement('p')
    p.className = 'modal-text'
    p.textContent = text
    card.appendChild(p)
  }

  const actions = document.createElement('div')
  actions.className = 'modal-actions'
  const okBtn = document.createElement('button')
  okBtn.className = 'btn btn--primary'
  okBtn.textContent = 'OK'
  okBtn.addEventListener('click', () => _dismiss(undefined))
  actions.appendChild(okBtn)
  card.appendChild(actions)

  requestAnimationFrame(() => okBtn.focus())

  return card
}

/**
 * Stacked action buttons + cancel — domain-agnostic; caller supplies labels and `value` per option.
 * @param {string} message
 * @param {Array<{ value: string, label: string, disabled?: boolean, title?: string }>} options
 * @param {{
 *   cancel?: string,
 *   selected?: string | null,
 *   displayRowFn?: (
 *     row: HTMLElement,
 *     option: { value: string, label: string, disabled?: boolean, title?: string },
 *     helpers: { dismiss: (value: string | null) => void, choose: () => void, button: HTMLButtonElement }
 *   ) => void
 * }} [opts]
 * @returns {HTMLElement}
 */
function _buildChoiceListModal (message, options, opts) {
  const card = document.createElement('div')
  card.className = 'modal'
  card.addEventListener('click', (e) => e.stopPropagation())

  if (message) {
    const p = document.createElement('p')
    p.className = 'modal-text'
    p.textContent = message
    card.appendChild(p)
  }

  const selectedValue =
    opts?.selected === null || opts?.selected === undefined
      ? null
      : String(opts.selected)

  const list = document.createElement('div')
  list.className = 'modal-choice-list'
  /** @type {HTMLButtonElement | null} */
  let selectedBtn = null
  for (const c of options) {
    const row = document.createElement('div')
    row.className = 'modal-choice-list__row'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'btn modal-choice-list__btn'
    btn.textContent = c.label
    btn.disabled = !!c.disabled
    if (c.title) btn.title = c.title
    if (selectedValue !== null && c.value === selectedValue) {
      btn.classList.add('modal-choice-list__btn--selected')
      btn.setAttribute('aria-pressed', 'true')
      if (!btn.disabled) selectedBtn = btn
    }
    btn.addEventListener('click', () => {
      if (btn.disabled) return
      _dismiss(c.value)
    })
    row.appendChild(btn)
    opts?.displayRowFn?.(row, c, {
      dismiss: (value) => _dismiss(value),
      choose: () => {
        if (btn.disabled) return
        _dismiss(c.value)
      },
      button: btn
    })
    list.appendChild(row)
  }
  card.appendChild(list)

  const actions = document.createElement('div')
  actions.className = 'modal-actions'
  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'btn'
  cancelBtn.textContent = opts?.cancel ?? 'Cancel'
  cancelBtn.addEventListener('click', () => _dismiss(null))
  actions.appendChild(cancelBtn)
  card.appendChild(actions)

  requestAnimationFrame(() => {
    if (selectedBtn) {
      selectedBtn.focus()
      return
    }
    const el = list.querySelector('button:not([disabled])')
    if (el instanceof HTMLElement) el.focus()
    else cancelBtn.focus()
  })

  return card
}

/**
 * Generic fullscreen text editor modal.
 * @param {{
 *   title?: string,
 *   text: string,
 *   saveLabel?: string,
 *   cancelLabel?: string
 * }} options
 * @returns {HTMLElement}
 */
function _buildFullscreenEditorModal (options) {
  const card = document.createElement('div')
  card.className = 'modal modal--fullscreen modal-full-editor'
  card.addEventListener('click', (e) => e.stopPropagation())

  const top = document.createElement('div')
  top.className = 'modal-full-editor__top'

  const title = document.createElement('p')
  title.className = 'modal-text modal-full-editor__title'
  title.textContent = options.title ?? 'Edit'

  const actions = document.createElement('div')
  actions.className = 'modal-actions'

  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.className = 'btn'
  cancelBtn.textContent = options.cancelLabel ?? 'Cancel'
  cancelBtn.addEventListener('click', () => _dismiss(null))

  const saveBtn = document.createElement('button')
  saveBtn.type = 'button'
  saveBtn.className = 'btn btn--primary'
  saveBtn.textContent = options.saveLabel ?? 'Save'

  actions.appendChild(cancelBtn)
  actions.appendChild(saveBtn)
  top.appendChild(title)
  top.appendChild(actions)

  const input = document.createElement('textarea')
  input.className = 'modal-input modal-full-editor__input'
  input.spellcheck = false
  input.value = options.text

  const onSave = () => {
    _dismiss(input.value)
  }
  saveBtn.addEventListener('click', onSave)
  input.addEventListener('keydown', (evt) => {
    const wantsSave = evt.key === 'Enter' && (evt.metaKey || evt.ctrlKey)
    if (!wantsSave) return
    evt.preventDefault()
    onSave()
  })

  card.appendChild(top)
  card.appendChild(input)
  requestAnimationFrame(() => input.focus())
  return card
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * @param {string} text
 * @param {() => void} [callback]
 * @returns {Promise<void>}
 */
export function alert (text, callback) {
  _dismiss(null)
  _ensureOverlay()
  return new Promise((resolve) => {
    _resolve = (val) => {
      resolve(val)
      callback?.()
    }
    _overlay.appendChild(_buildAlert(text))
    _overlay.classList.add('is-open')
  })
}

/**
 * @param {string} text
 * @param {() => void} [callback]
 * @returns {Promise<void>}
 */
export function warn (text, callback) {
  return alert(text, callback)
}

/**
 * @param {string} text
 * @param {{ yes?: string, no?: string }} [buttons]
 * @param {(ok: boolean) => void} [callback]
 * @returns {Promise<boolean>}
 */
export function confirm (text, buttons, callback) {
  _dismiss(null)
  _ensureOverlay()
  return new Promise((resolve) => {
    _resolve = (val) => {
      resolve(/** @type {boolean} */ (val))
      callback?.(/** @type {boolean} */ (val))
    }
    _overlay.appendChild(_buildConfirm(text, buttons))
    _overlay.classList.add('is-open')
  })
}

/**
 * Each field’s value is returned with {@link String.prototype.trim} applied (whitespace-only becomes `""`).
 * @param {string} text
 * @param {Array<{ label: string, key: string, type?: string, placeholder?: string, value?: string }>} fields
 * @param {{ submit?: string, cancel?: string }} [buttons]
 * @param {(values: Record<string, string> | null) => void} [callback]
 * @returns {Promise<Record<string, string> | null>}
 */
export function prompt (text, fields, buttons, callback) {
  _dismiss(null)
  _ensureOverlay()
  return new Promise((resolve) => {
    _resolve = (val) => {
      resolve(/** @type {Record<string, string> | null} */ (val))
      callback?.(/** @type {Record<string, string> | null} */ (val))
    }
    _overlay.appendChild(_buildPrompt(text, fields, buttons))
    _overlay.classList.add('is-open')
  })
}

/**
 * Modal with a short message, a vertical list of choices, and Cancel.
 * Returns the chosen option’s `value`, or `null` if the user cancels (Cancel or overlay click).
 * Pass `selected` to highlight (and focus) the currently chosen option.
 * @param {string} message
 * @param {Array<{ value: string, label: string, disabled?: boolean, title?: string }>} options
 * @param {{
 *   cancel?: string,
 *   selected?: string | null,
 *   callback?: (choice: string | null) => void,
 *   displayRowFn?: (
 *     row: HTMLElement,
 *     option: { value: string, label: string, disabled?: boolean, title?: string },
 *     helpers: { dismiss: (value: string | null) => void, choose: () => void, button: HTMLButtonElement }
 *   ) => void
 * }} [opts]
 * @returns {Promise<string | null>}
 */
export function pickChoice (message, options, opts) {
  _dismiss(null)
  _ensureOverlay()
  return new Promise((resolve) => {
    _resolve = (val) => {
      resolve(/** @type {string | null} */ (val))
      opts?.callback?.(/** @type {string | null} */ (val))
    }
    _overlay.appendChild(_buildChoiceListModal(message, options, opts))
    _overlay.classList.add('is-open')
  })
}

/**
 * Caller builds the full modal card (same `.modal` styling as other dialogs).
 * Call `dismiss(payload)` when finished; the returned promise resolves with that payload,
 * or `null` if the user dismissed via overlay click (same as other modals).
 *
 * @template T
 * @param {(dismiss: (value: T | null) => void) => HTMLElement} factory
 * @returns {Promise<T | null>}
 */
export function openModalCard (factory) {
  _dismiss(null)
  _ensureOverlay()
  return new Promise((resolve) => {
    _resolve = (val) => {
      resolve(/** @type {T | null} */ (val))
    }
    const dismiss = (value) => {
      _dismiss(value)
    }
    const card = factory(dismiss)
    _overlay.appendChild(card)
    _overlay.classList.add('is-open')
  })
}

/**
 * Opens a generic fullscreen text editor.
 * @param {{
 *   title?: string,
 *   text?: string,
 *   saveLabel?: string,
 *   cancelLabel?: string,
 *   callback?: (value: string | null) => void
 * }} options
 * @returns {Promise<string | null>}
 */
export function editText (options) {
  _dismiss(null)
  _ensureOverlay()
  _overlay.classList.add('modal-overlay--fullscreen')
  return new Promise((resolve) => {
    _resolve = (val) => {
      resolve(/** @type {string | null} */ (val))
      options.callback?.(/** @type {string | null} */ (val))
    }
    _overlay.appendChild(_buildFullscreenEditorModal({
      title: options.title,
      text: options.text ?? '',
      saveLabel: options.saveLabel,
      cancelLabel: options.cancelLabel
    }))
    _overlay.classList.add('is-open')
  })
}

/**
 * Waits for any key (`KeyboardEvent.key`) or an explicit “no key” action.
 * @param {string} message
 * @param {string} [noKeyLabel]
 * @returns {Promise<string | null>} `event.key` when a key is pressed; `''` when “no key” is chosen; `null` if cancelled (Escape or overlay click).
 */
export function sampleKey (message, noKeyLabel = 'No Key') {
  _dismiss(null)
  _ensureOverlay()
  return new Promise((resolve) => {
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      window.removeEventListener('keydown', onKeyDown, true)
    }
    _resolve = (val) => {
      cleanup()
      resolve(/** @type {string | null} */ (val))
    }

    const card = document.createElement('div')
    card.className = 'modal modal--sample-key'
    card.tabIndex = -1
    card.setAttribute('role', 'dialog')
    card.addEventListener('click', (e) => e.stopPropagation())

    const p = document.createElement('p')
    p.className = 'modal-text'
    p.textContent = message

    const actions = document.createElement('div')
    actions.className = 'modal-actions'

    const noKeyBtn = document.createElement('button')
    noKeyBtn.type = 'button'
    noKeyBtn.className = 'btn'
    noKeyBtn.textContent = noKeyLabel
    noKeyBtn.addEventListener('click', (e) => {
      e.preventDefault()
      _dismiss('')
    })

    actions.appendChild(noKeyBtn)
    card.appendChild(p)
    card.appendChild(actions)

    /** @param {KeyboardEvent} e */
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        _dismiss(null)
        return
      }
      if (e.repeat) return
      if (_isModifierOnlyKeydown(e)) return
      e.preventDefault()
      e.stopPropagation()
      _dismiss(e.key)
    }

    window.addEventListener('keydown', onKeyDown, true)
    _overlay.appendChild(card)
    _overlay.classList.add('is-open')
    requestAnimationFrame(() => card.focus())
  })
}

/** Named exports plus `Modal.sampleKey`-style access */
export const Modal = {
  alert,
  warn,
  confirm,
  prompt,
  pickChoice,
  openModalCard,
  editText,
  sampleKey
}
