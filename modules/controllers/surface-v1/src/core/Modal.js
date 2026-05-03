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
  _overlay.innerHTML = ''
  const cb = _resolve
  _resolve = null
  cb?.(value)
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
 * @param {{ cancel?: string }} [opts]
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

  const list = document.createElement('div')
  list.className = 'modal-choice-list'
  for (const c of options) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'btn modal-choice-list__btn'
    btn.textContent = c.label
    btn.disabled = !!c.disabled
    if (c.title) btn.title = c.title
    btn.addEventListener('click', () => {
      if (btn.disabled) return
      _dismiss(c.value)
    })
    list.appendChild(btn)
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
    const el = list.querySelector('button:not([disabled])')
    if (el instanceof HTMLElement) el.focus()
    else cancelBtn.focus()
  })

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
 * @param {string} message
 * @param {Array<{ value: string, label: string, disabled?: boolean, title?: string }>} options
 * @param {{ cancel?: string, callback?: (choice: string | null) => void }} [opts]
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
