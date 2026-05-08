import { pickChoice } from '../../core/Modal.js'

/**
 * iOS-safe replacement for native <select>.
 * Renders a small button-styled control; clicking opens a dark modal picker.
 */
export class SelectPopup {
  /**
   * @param {{
   *  value: unknown
   *  options: Array<string> | Array<{ value: string, label: string, disabled?: boolean, title?: string }>
   *  onChange: (value: string) => void
   *  ariaLabel?: string
   * }} opts
   */
  constructor (opts) {
    /** @type {unknown} */
    this._value = opts.value
    /**
     * Normalized option objects for pickChoice:
     * { value, label, disabled?, title? }.
     * @type {Array<{ value: string, label: string, disabled?: boolean, title?: string }>}
     */
    this._options = Array.isArray(opts.options)
      ? /** @type {any} */ (opts.options).map(o => {
          if (typeof o === 'string') {
            return { value: String(o), label: String(o) }
          }
          return {
            value: String(o.value),
            label: String(o.label),
            disabled: o.disabled === true,
            title: typeof o.title === 'string' ? o.title : undefined
          }
        })
      : []
    /** @type {(v: string) => void} */
    this._onChange = opts.onChange
    /** @type {string} */
    this._ariaLabel = opts.ariaLabel ?? 'Select option'

    /** @type {HTMLButtonElement | null} */
    this._button = null
  }

  /**
   * @param {HTMLElement} parent
   * @returns {HTMLButtonElement}
   */
  mount (parent) {
    this.destroy()

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'perform-animate-field__select'
    btn.setAttribute('aria-label', this._ariaLabel)
    btn.title = this._ariaLabel

    const sync = () => {
      const vStr =
        this._value === null || this._value === undefined
          ? ''
          : String(this._value)
      const hit =
        vStr !== '' ? this._options.find(o => o.value === vStr) : null
      btn.textContent = (hit?.label ?? vStr) || '—'
    }
    this._button = btn
    sync()

    btn.addEventListener('click', async () => {
      const choice = await pickChoice('', this._options, {
        cancel: 'Cancel'
      })
      if (choice === null) return

      this._value = choice
      sync()
      this._onChange(choice)
    })

    parent.appendChild(btn)
    return btn
  }

  /** @returns {void} */
  destroy () {
    if (this._button && this._button.parentNode) {
      this._button.remove()
    }
    this._button = null
  }

  /** @param {unknown} v */
  syncFromExternal (v) {
    this._value = v
    this._button && (this._button.textContent = v === null || v === undefined ? '—' : String(v))
  }
}

