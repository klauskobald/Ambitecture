import { listDotKeyOptionsForIntent } from './intentDotKeyOptions.js'

/**
 * @param {HTMLElement} keyMount
 * @param {{
 *   intentGuid: string,
 *   getIntentClass: (guid: string) => string | null,
 *   systemCapabilities: unknown,
 *   currentKey: string,
 *   defaultDotKey: string,
 *   normalizeDotKey: (raw: string) => string,
 *   disabled: boolean,
 *   onCommit: () => void
 * }} opts
 * @returns {void}
 */
export function renderIntentDotKeyControl (keyMount, opts) {
  keyMount.replaceChildren()
  const intentGuid = opts.intentGuid
  if (!intentGuid) return

  const baseOpts = listDotKeyOptionsForIntent(
    intentGuid,
    opts.getIntentClass,
    opts.systemCapabilities
  )
  let cur =
    opts.normalizeDotKey(opts.currentKey) || opts.defaultDotKey

  if (baseOpts.length > 0) {
    const rows = [...baseOpts]
    if (!rows.some(o => o.dotKey === cur)) {
      rows.unshift({ dotKey: cur, name: `${cur} (custom)` })
    }
    const sel = document.createElement('select')
    sel.className = 'modal__select modal__select--dotkey'
    sel.setAttribute('aria-label', 'Intent parameter dot path')
    const seen = new Set()
    for (const o of rows) {
      if (seen.has(o.dotKey)) continue
      seen.add(o.dotKey)
      const opt = document.createElement('option')
      opt.value = o.dotKey
      opt.textContent = o.name
      sel.appendChild(opt)
    }
    sel.disabled = opts.disabled
    sel.value = [...sel.options].some(o => o.value === cur)
      ? cur
      : rows[0].dotKey
    sel.addEventListener('change', opts.onCommit)
    keyMount.appendChild(sel)
    return
  }

  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'modal__input-text modal__input-text--15'
  input.maxLength = 64
  input.size = 15
  input.value = cur
  input.disabled = opts.disabled
  input.setAttribute('aria-label', 'Intent parameter dot path')
  input.setAttribute('autocapitalize', 'none')
  input.setAttribute('spellcheck', 'false')
  input.title = 'Dot path (lowercase, e.g. xyy.x)'
  input.addEventListener('input', () => {
    const v = input.value
    const lower = v.toLowerCase()
    if (v !== lower) {
      const start = input.selectionStart
      const end = input.selectionEnd
      input.value = lower
      if (start !== null && end !== null) {
        input.setSelectionRange(start, end)
      }
    }
    opts.onCommit()
  })
  input.addEventListener('change', opts.onCommit)
  keyMount.appendChild(input)
}

/**
 * @param {HTMLElement} keyMount
 * @param {(raw: string) => string} normalizeDotKey
 * @param {string} defaultDotKey
 * @returns {string}
 */
export function readDotKeyFromMount (keyMount, normalizeDotKey, defaultDotKey) {
  const el = keyMount.firstElementChild
  if (!el) return defaultDotKey
  if (el instanceof HTMLSelectElement) {
    const k = normalizeDotKey(el.value)
    return k || defaultDotKey
  }
  if (el instanceof HTMLInputElement) {
    const k = normalizeDotKey(el.value)
    return k || defaultDotKey
  }
  return defaultDotKey
}

/**
 * @param {HTMLElement} keyMount
 * @param {boolean} disabled
 */
export function setDotKeyMountDisabled (keyMount, disabled) {
  const el = keyMount.firstElementChild
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
    el.disabled = disabled
  }
}
