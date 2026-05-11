import { ScalarRadialKnobSvg } from './ScalarRadialKnobSvg.js'

/** Used only for dataset / knob identity in non-graph editors. */
const PARAM_EDITOR_INTENT_GUID = '__paramEditor__'

/**
 * @typedef {object} AugmentedComponent
 * @property {string} key  component dot suffix (e.g. "0" / "x"); concatenated as `${parent.key}.${key}`
 * @property {string} name  display label (e.g. "X")
 * @property {Record<string, unknown>} descriptor  per-component descriptor (range/step/defaultValue/...)
 */

/**
 * @typedef {object} AugmentedItem
 * @property {string} key  dotKey (e.g. params.alpha)
 * @property {string} name  display label
 * @property {'slider'|'dropdown'|'text'|'json'|'components'} display
 * @property {Record<string, unknown>} [descriptor]  full hub descriptor (scalar knob)
 * @property {string[]} [options]  enum options
 * @property {AugmentedComponent[]} [components]  per-component breakdown for vector-style items
 */

/**
 * @typedef {object} AugmentedSelectBinding
 * @property {() => unknown} readValue
 * @property {(v: unknown) => void} writeValue
 * @property {(prevKey: string, nextKey: string) => void} onKeyChange
 * @property {(checkedKeys: string[], values: Record<string, unknown>) => void} [writeComponents]  components mode only; binding decides flat-vs-array shape
 * @property {() => { checked: Set<string>, values: Record<string, unknown> }} [readComponents]  components mode only
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
    /** @type {AbortController | null} */
    this._rowAbort = null
    /** @type {AbortController | null} */
    this._valueAbort = null
    /** @type {Map<string, ScalarRadialKnobSvg>} */
    this._componentKnobs = new Map()
    /** @type {Map<string, HTMLInputElement>} */
    this._componentChecks = new Map()
    /** @type {Map<string, HTMLElement>} */
    this._componentKnobHosts = new Map()
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

    this._rowAbort = new AbortController()
    const rowSignal = this._rowAbort.signal

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

    sel.addEventListener(
      'change',
      () => {
        const prev = this._key
        const next = sel.value
        if (next === prev) return
        binding.onKeyChange(prev, next)
        this._key = next
        this._applyDisabledToOptions()
        this._rebuildValueWidget()
        this._emitChange()
      },
      { signal: rowSignal }
    )

    row.appendChild(sel)

    this._valueHost = document.createElement('div')
    this._valueHost.className = 'augmented-select__value'
    row.appendChild(this._valueHost)
    this._mountValueWidget()

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
    if (this._componentKnobs.size > 0 || this._componentChecks.size > 0) {
      this._syncComponentsFromBinding()
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
    for (const k of this._componentKnobs.values()) k.destroy()
    this._componentKnobs.clear()
    this._componentChecks.clear()
    this._componentKnobHosts.clear()
    this._valueAbort?.abort()
    this._valueAbort = null
    this._simpleControl = null
    if (this._valueHost) this._valueHost.replaceChildren()
  }

  _rebuildValueWidget () {
    if (!this._valueHost || !this._binding) return
    this._clearValueWidget()
    this._mountValueWidget()
  }

  _mountValueWidget () {
    const binding = this._binding
    if (!binding || !this._valueHost) return

    const item = this._currentItem()
    if (!item) return

    if (
      item.display === 'components' &&
      Array.isArray(item.components) &&
      item.components.length > 0
    ) {
      this._mountComponentsWidget(item, binding)
      return
    }

    if (!this._requireValue) return

    if (item.display === 'slider' && item.descriptor) {
      const knob = new ScalarRadialKnobSvg({
        descriptor: item.descriptor,
        intentGuid: PARAM_EDITOR_INTENT_GUID,
        readValue: () => {
          const v = binding.readValue()
          const n = Number(v)
          return Number.isFinite(n)
            ? n
            : Number(item.descriptor?.defaultValue ?? 0)
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

    if (
      item.display === 'dropdown' &&
      item.options &&
      item.options.length > 0
    ) {
      this._valueAbort = new AbortController()
      const signal = this._valueAbort.signal
      const dd = document.createElement('select')
      dd.className =
        'modal-input modal-select-capitalize augmented-select__enum'
      for (const optLabel of item.options) {
        const opt = document.createElement('option')
        opt.value = optLabel
        opt.textContent = optLabel
        dd.appendChild(opt)
      }
      const raw = binding.readValue()
      const s =
        raw === undefined || raw === null
          ? String(item.options[0])
          : String(raw)
      dd.value = item.options.includes(s) ? s : item.options[0]
      dd.addEventListener(
        'change',
        () => {
          binding.writeValue(dd.value)
          this._emitChange()
        },
        { signal }
      )
      this._valueHost.appendChild(dd)
      this._simpleControl = dd
      return
    }

    if (item.display === 'text') {
      this._valueAbort = new AbortController()
      const signal = this._valueAbort.signal
      const inp = document.createElement('input')
      inp.type = 'text'
      inp.className = 'modal-input augmented-select__text'
      const raw = binding.readValue()
      inp.value = raw === undefined || raw === null ? '' : String(raw)
      inp.addEventListener(
        'change',
        () => {
          binding.writeValue(inp.value)
          this._emitChange()
        },
        { signal }
      )
      this._valueHost.appendChild(inp)
      this._simpleControl = inp
      return
    }

    this._valueAbort = new AbortController()
    const signal = this._valueAbort.signal
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
      ta.value = raw === undefined || raw === null ? '' : String(raw)
    }
    ta.addEventListener(
      'change',
      () => {
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
      },
      { signal }
    )
    this._valueHost.appendChild(ta)
    this._simpleControl = ta
  }

  /**
   * @param {AugmentedItem} item
   * @param {AugmentedSelectBinding} binding
   */
  _mountComponentsWidget (item, binding) {
    if (!this._valueHost) return
    const comps = item.components
    if (!Array.isArray(comps) || comps.length === 0) return

    this._valueAbort = new AbortController()
    const signal = this._valueAbort.signal

    const wrap = document.createElement('div')
    wrap.className = 'augmented-select__components'

    const initial = binding.readComponents?.() ?? {
      checked: new Set(),
      values: {}
    }

    for (const comp of comps) {
      const ckey = String(comp.key)
      const compRow = document.createElement('div')
      compRow.className = 'augmented-select__component-row'

      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.id = `${this._id}-${item.key}-${ckey}`
      cb.className = 'augmented-select__component-check'
      cb.checked = initial.checked.has(ckey)

      const lab = document.createElement('label')
      lab.className = 'augmented-select__component-label'
      lab.setAttribute('for', cb.id)
      lab.textContent = comp.name

      compRow.appendChild(cb)
      compRow.appendChild(lab)

      this._componentChecks.set(ckey, cb)

      if (this._requireValue) {
        const knobHost = document.createElement('div')
        knobHost.className = 'augmented-select__component-knob'
        knobHost.hidden = !cb.checked
        compRow.appendChild(knobHost)
        this._componentKnobHosts.set(ckey, knobHost)
        if (cb.checked) {
          this._mountComponentKnob(item.key, comp, knobHost, binding)
        }
      }

      cb.addEventListener(
        'change',
        () => this._onComponentCheckbox(item, binding, ckey),
        { signal }
      )

      wrap.appendChild(compRow)
    }

    this._valueHost.appendChild(wrap)
  }

  /**
   * @param {string} dotKey
   * @param {AugmentedComponent} comp
   * @param {HTMLElement} host
   * @param {AugmentedSelectBinding} binding
   */
  _mountComponentKnob (dotKey, comp, host, binding) {
    const ckey = String(comp.key)
    const knobDescriptor = {
      ...comp.descriptor,
      dotKey: `${dotKey}.${ckey}`,
      name: comp.name
    }
    const knob = new ScalarRadialKnobSvg({
      descriptor: knobDescriptor,
      intentGuid: PARAM_EDITOR_INTENT_GUID,
      readValue: () => {
        const snap = binding.readComponents?.() ?? {
          checked: new Set(),
          values: {}
        }
        const v = snap.values[ckey]
        const n = Number(v)
        if (Number.isFinite(n)) return n
        return Number(comp.descriptor.defaultValue ?? 0)
      },
      onCommit: domain => {
        this._recomputeComponentsWrite(binding, { [ckey]: domain })
        this._emitChange()
      },
      showInnerSvgTitle: false
    })
    knob.mount(host)
    this._componentKnobs.set(ckey, knob)
    knob.syncFromExternal()
  }

  /**
   * @param {AugmentedItem} item
   * @param {AugmentedSelectBinding} binding
   * @param {string} ckey
   */
  _onComponentCheckbox (item, binding, ckey) {
    const cb = this._componentChecks.get(ckey)
    if (!cb) return

    if (this._requireValue) {
      const host = this._componentKnobHosts.get(ckey)
      if (host) {
        if (cb.checked) {
          host.hidden = false
          if (!this._componentKnobs.has(ckey)) {
            const comp = item.components?.find(c => String(c.key) === ckey)
            if (comp) this._mountComponentKnob(item.key, comp, host, binding)
          }
        } else {
          host.hidden = true
          const k = this._componentKnobs.get(ckey)
          if (k) {
            k.destroy()
            this._componentKnobs.delete(ckey)
          }
        }
      }
    }

    this._recomputeComponentsWrite(binding)
    this._emitChange()
  }

  /**
   * @param {AugmentedSelectBinding} binding
   * @param {Record<string, unknown>} [valueOverrides]  knob-just-committed values not yet in params
   */
  _recomputeComponentsWrite (binding, valueOverrides = {}) {
    const writeComponents = binding.writeComponents
    const readComponents = binding.readComponents
    if (!writeComponents || !readComponents) return
    const item = this._currentItem()
    const comps = item?.components
    if (!comps) return

    const snap = readComponents()
    /** @type {string[]} */
    const checkedKeys = []
    /** @type {Record<string, unknown>} */
    const values = {}
    for (const comp of comps) {
      const ck = String(comp.key)
      const cb = this._componentChecks.get(ck)
      if (!cb?.checked) continue
      checkedKeys.push(ck)
      if (this._requireValue) {
        if (ck in valueOverrides) values[ck] = valueOverrides[ck]
        else if (snap.values[ck] !== undefined) values[ck] = snap.values[ck]
        else values[ck] = Number(comp.descriptor.defaultValue ?? 0)
      }
    }
    writeComponents(checkedKeys, values)
  }

  _syncComponentsFromBinding () {
    const binding = this._binding
    if (!binding?.readComponents) return
    const snap = binding.readComponents()
    for (const [ck, cb] of this._componentChecks) {
      const want = snap.checked.has(ck)
      if (cb.checked !== want) cb.checked = want
      const host = this._componentKnobHosts.get(ck)
      if (host) host.hidden = !want
      const knob = this._componentKnobs.get(ck)
      if (want && !knob && this._requireValue && host) {
        const item = this._currentItem()
        const comp = item?.components?.find(c => String(c.key) === ck)
        if (item && comp) this._mountComponentKnob(item.key, comp, host, binding)
      } else if (!want && knob) {
        knob.destroy()
        this._componentKnobs.delete(ck)
      } else if (knob) {
        knob.syncFromExternal()
      }
    }
  }

  destroy () {
    this._rowAbort?.abort()
    this._rowAbort = null
    this._clearValueWidget()
    this._valueHost = null
    this._selectEl = null
    this._root = null
    this._binding = null
  }
}
