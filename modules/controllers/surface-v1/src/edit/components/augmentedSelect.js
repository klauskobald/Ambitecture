import { ScalarRadialKnobSvg } from './ScalarRadialKnobSvg.js'

/** Used only for dataset / knob identity in non-graph editors. */
const PARAM_EDITOR_INTENT_GUID = '__paramEditor__'

/**
 * @typedef {object} AugmentedItem
 * @property {string} key  dotKey (e.g. params.alpha)
 * @property {string} name  display label
 * @property {'slider'|'dropdown'|'text'|'json'} display
 * @property {Record<string, unknown>} [descriptor]  full hub descriptor (scalar knob)
 * @property {string[]} [options]  enum options
 */

/**
 * @typedef {object} AugmentedSelectBinding
 * @property {() => unknown} readValue
 * @property {(v: unknown) => void} writeValue
 * @property {(prevKey: string, nextKey: string) => void} onKeyChange
 */

export class AugmentedSelect {
  /**
   * @param {string} id
   * @param {AugmentedItem[]} items
   * @param {boolean} [requireValue]
   */
  constructor (id, items, requireValue = true) {
    this._id = id
    this._items = items
    this._requireValue = requireValue
    this._key = items[0]?.key ?? ''
    this._root = null
    this._selectEl = null
    this._valueHost = null
    /** @type {ScalarRadialKnobSvg | null} */
    this._knob = null
    /** @type {HTMLSelectElement | HTMLInputElement | HTMLTextAreaElement | null} */
    this._simpleControl = null
    /** @type {AugmentedSelectBinding | null} */
    this._binding = null
    /** @type {(() => void) | null} */
    this._userChange = null
    /** @type {Set<string>} */
    this._disabledKeys = new Set()
  }

  /**
   * @param {Set<string>} set  keys disabled for pick (e.g. used in other rows)
   */
  setDisabledKeys (set) {
    this._disabledKeys = set
    this._applyDisabledToOptions()
  }

  setSelectedKey (key) {
    this._key = key
    if (this._selectEl) this._selectEl.value = key
    this._rebuildValueWidget()
  }

  /** @returns {string} */
  getSelectedKey () {
    return this._key
  }

  /** @param {() => void} fn */
  onChange (fn) {
    this._userChange = fn
  }

  _applyDisabledToOptions () {
    if (!this._selectEl) return
    const cur = this._key
    for (const opt of this._selectEl.querySelectorAll('option')) {
      if (!(opt instanceof HTMLOptionElement)) continue
      const v = opt.value
      opt.disabled = this._disabledKeys.has(v) && v !== cur
    }
  }

  _emitChange () {
    this._userChange?.()
  }

  /**
   * @param {AugmentedSelectBinding} binding
   * @returns {HTMLElement}
   */
  build (binding) {
    this.destroy()
    this._binding = binding

    const root = document.createElement('div')
    root.className = 'augmented-select'
    root.dataset.augmentedSelectId = this._id

    const row = document.createElement('div')
    row.className = 'augmented-select__row'

    const sel = document.createElement('select')
    sel.className = 'modal-input modal-select-capitalize augmented-select__key'
    sel.setAttribute('aria-label', 'Parameter')
    for (const it of this._items) {
      const opt = document.createElement('option')
      opt.value = it.key
      opt.textContent = it.name
      sel.appendChild(opt)
    }
    sel.value = this._key
    this._selectEl = sel

    sel.addEventListener('change', () => {
      const prev = this._key
      const next = sel.value
      if (next === prev) return
      binding.onKeyChange(prev, next)
      this._key = next
      this._applyDisabledToOptions()
      this._rebuildValueWidget()
      this._emitChange()
    })

    row.appendChild(sel)

    if (this._requireValue) {
      this._valueHost = document.createElement('div')
      this._valueHost.className = 'augmented-select__value'
      row.appendChild(this._valueHost)
      this._mountValueWidget()
    }

    this._root = root
    root.appendChild(row)
    this._applyDisabledToOptions()
    return root
  }

  syncValueFromBinding () {
    if (this._knob) {
      this._knob.syncFromExternal()
      return
    }
    if (this._simpleControl && this._binding) {
      const v = this._binding.readValue()
      if (this._simpleControl instanceof HTMLSelectElement) {
        this._simpleControl.value =
          v === undefined || v === null ? '' : String(v)
      } else if (this._simpleControl instanceof HTMLInputElement) {
        this._simpleControl.value =
          v === undefined || v === null ? '' : String(v)
      } else if (this._simpleControl instanceof HTMLTextAreaElement) {
        if (v !== undefined && v !== null && typeof v === 'object') {
          try {
            this._simpleControl.value = JSON.stringify(v)
          } catch {
            this._simpleControl.value = ''
          }
        } else {
          this._simpleControl.value =
            v === undefined || v === null ? '' : String(v)
        }
      }
    }
  }

  _currentItem () {
    return this._items.find(i => i.key === this._key) ?? this._items[0]
  }

  _clearValueWidget () {
    this._knob?.destroy()
    this._knob = null
    this._simpleControl = null
    if (this._valueHost) this._valueHost.replaceChildren()
  }

  _rebuildValueWidget () {
    if (!this._requireValue || !this._valueHost || !this._binding) return
    this._clearValueWidget()
    this._mountValueWidget()
  }

  _mountValueWidget () {
    const binding = this._binding
    if (!binding || !this._valueHost) return

    const item = this._currentItem()
    if (!item) return

    if (item.display === 'slider' && item.descriptor) {
      const knob = new ScalarRadialKnobSvg({
        descriptor: item.descriptor,
        intentGuid: PARAM_EDITOR_INTENT_GUID,
        readValue: () => {
          const v = binding.readValue()
          const n = Number(v)
          return Number.isFinite(n) ? n : Number(item.descriptor?.defaultValue ?? 0)
        },
        onCommit: domain => {
          binding.writeValue(domain)
          this._emitChange()
        },
        showInnerSvgTitle: false
      })
      const host = document.createElement('div')
      host.className = 'augmented-select__knob-wrap'
      knob.mount(host)
      this._valueHost.appendChild(host)
      this._knob = knob
      knob.syncFromExternal()
      return
    }

    if (item.display === 'dropdown' && item.options && item.options.length > 0) {
      const dd = document.createElement('select')
      dd.className = 'modal-input modal-select-capitalize augmented-select__enum'
      for (const optLabel of item.options) {
        const opt = document.createElement('option')
        opt.value = optLabel
        opt.textContent = optLabel
        dd.appendChild(opt)
      }
      const raw = binding.readValue()
      const s =
        raw === undefined || raw === null ? String(item.options[0]) : String(raw)
      dd.value = item.options.includes(s) ? s : item.options[0]
      dd.addEventListener('change', () => {
        binding.writeValue(dd.value)
        this._emitChange()
      })
      this._valueHost.appendChild(dd)
      this._simpleControl = dd
      return
    }

    if (item.display === 'text') {
      const inp = document.createElement('input')
      inp.type = 'text'
      inp.className = 'modal-input augmented-select__text'
      const raw = binding.readValue()
      inp.value =
        raw === undefined || raw === null ? '' : String(raw)
      inp.addEventListener('change', () => {
        binding.writeValue(inp.value)
        this._emitChange()
      })
      this._valueHost.appendChild(inp)
      this._simpleControl = inp
      return
    }

    const ta = document.createElement('textarea')
    ta.className = 'modal-input input-assign-modal__json augmented-select__json'
    ta.spellcheck = false
    const raw = binding.readValue()
    if (raw !== undefined && raw !== null && typeof raw === 'object') {
      try {
        ta.value = JSON.stringify(raw)
      } catch {
        ta.value = ''
      }
    } else {
      ta.value =
        raw === undefined || raw === null ? '' : String(raw)
    }
    ta.addEventListener('change', () => {
      const t = ta.value.trim()
      if (!t) {
        binding.writeValue(undefined)
        this._emitChange()
        return
      }
      try {
        binding.writeValue(JSON.parse(t))
      } catch {
        binding.writeValue(t)
      }
      this._emitChange()
    })
    this._valueHost.appendChild(ta)
    this._simpleControl = ta
  }

  destroy () {
    this._clearValueWidget()
    this._valueHost = null
    this._selectEl = null
    this._root = null
    this._binding = null
  }
}
