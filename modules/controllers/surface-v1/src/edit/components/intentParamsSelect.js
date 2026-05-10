import { AugmentedSelect } from './augmentedSelect.js'

/**
 * @typedef {object} IntentParamsLifecycle
 * @property {'add'|'remove'|'change'} phase
 * @property {string} [key]
 * @property {Record<string, unknown>} params
 */

/**
 * @param {unknown} d
 * @returns {import('./augmentedSelect.js').AugmentedItem}
 */
export function descriptorToAugmentedItem (d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    return { key: '', name: '', display: 'json' }
  }
  const rec = /** @type {Record<string, unknown>} */ (d)
  const dotKey = String(rec.dotKey ?? '')
  const name = String(rec.name ?? dotKey)
  const type = String(rec.type ?? '')
  /** @type {'slider'|'dropdown'|'text'|'json'} */
  let display = 'json'
  if (type === 'scalar') display = 'slider'
  else if (
    type === 'string' &&
    Array.isArray(rec.options) &&
    rec.options.length > 0
  ) {
    display = 'dropdown'
  } else if (type === 'string') display = 'text'
  else if (type === 'color') display = 'json'

  const options = Array.isArray(rec.options)
    ? /** @type {unknown[]} */ (rec.options).map(x => String(x))
    : undefined

  return {
    key: dotKey,
    name,
    display,
    descriptor: rec,
    options
  }
}

/**
 * @param {import('./augmentedSelect.js').AugmentedItem} item
 * @returns {unknown}
 */
function defaultValueForItem (item) {
  const desc = item.descriptor
  if (!desc || typeof desc !== 'object' || Array.isArray(desc)) {
    return undefined
  }
  if (item.display === 'slider') {
    const raw = /** @type {Record<string, unknown>} */ (desc).defaultValue
    const n = Number(raw)
    if (Number.isFinite(n)) return n
    const r = /** @type {number[] | undefined} */ (
      /** @type {Record<string, unknown>} */ (desc).range
    )
    if (Array.isArray(r) && r.length > 0) return Number(r[0])
    return 0
  }
  if (item.display === 'dropdown') {
    const opts = item.options ?? []
    const raw = /** @type {Record<string, unknown>} */ (desc).defaultValue
    if (typeof raw === 'string' && opts.includes(raw)) return raw
    return opts[0]
  }
  if (item.display === 'text') {
    const raw = /** @type {Record<string, unknown>} */ (desc).defaultValue
    return raw === undefined || raw === null ? '' : String(raw)
  }
  return undefined
}

export class IntentParamsSelect {
  /**
   * @param {boolean} [requireValues]
   */
  constructor (requireValues = true) {
    this._requireValues = requireValues
    /** @type {AugmentedSelect[]} */
    this._widgets = []
    /** @type {number} */
    this._rowSeq = 0
  }

  /**
   * @param {object} opts
   * @param {string} opts.id
   * @param {Record<string, unknown>} opts.params  mutated in place
   * @param {unknown[]} opts.descriptors  resolved intent property descriptors
   * @param {(ev: IntentParamsLifecycle) => void} [opts.onLifecycle]
   * @returns {{ root: HTMLElement, destroy: () => void }}
   */
  build (opts) {
    const id = opts.id
    const params = opts.params
    const descriptors = opts.descriptors
    const onLifecycle = opts.onLifecycle

    /** @type {import('./augmentedSelect.js').AugmentedItem[]} */
    const baseItems = []
    for (const d of descriptors) {
      const it = descriptorToAugmentedItem(d)
      if (it.key.length > 0) baseItems.push(it)
    }

    /** @type {import('./augmentedSelect.js').AugmentedItem[]} */
    const items = [...baseItems]
    const itemByKey = new Map(items.map(it => [it.key, it]))
    for (const k of Object.keys(params)) {
      if (!itemByKey.has(k)) {
        const orphan = {
          key: k,
          name: k,
          display: /** @type {'json'} */ ('json'),
          descriptor: {}
        }
        items.push(orphan)
        itemByKey.set(k, orphan)
      }
    }

    const root = document.createElement('div')
    root.className = 'intent-params-select'
    root.dataset.intentParamsId = id

    const rowsEl = document.createElement('div')
    rowsEl.className = 'intent-params-select__rows'

    const addBtn = document.createElement('button')
    addBtn.type = 'button'
    addBtn.className = 'btn intent-params-select__add'
    addBtn.textContent = '+'

    const emit = (phase, key) => {
      onLifecycle?.({ phase, key, params })
    }

    const destroyAllWidgets = () => {
      for (const w of this._widgets) w.destroy()
      this._widgets = []
    }

    const self = this

    const usedKeysExcept = except => {
      const s = new Set(Object.keys(params))
      if (except) s.delete(except)
      return s
    }

    /**
     * @param {string} initialKey
     */
    const appendRow = initialKey => {
      const state = { key: initialKey }
      self._rowSeq += 1
      const rowId = `${id}-r-${self._rowSeq}`

      const row = document.createElement('div')
      row.className = 'intent-params-row'

      const as = new AugmentedSelect(rowId, items, self._requireValues)
      as.setDisabledKeys(usedKeysExcept(state.key))
      as.setSelectedKey(state.key)
      as.onChange(() => emit('change', state.key))

      const binding = {
        readValue: () => params[state.key],
        writeValue: v => {
          if (v === undefined) delete params[state.key]
          else params[state.key] = v
        },
        onKeyChange: (prev, next) => {
          const v = params[prev]
          delete params[prev]
          state.key = next
          const it = itemByKey.get(next)
          const def = it ? defaultValueForItem(it) : undefined
          params[next] = v !== undefined ? v : def
          as.setDisabledKeys(usedKeysExcept(state.key))
        }
      }

      const el = as.build(binding)
      self._widgets.push(as)

      const rm = document.createElement('button')
      rm.type = 'button'
      rm.className = 'btn intent-params-select__remove'
      rm.textContent = '−'
      rm.setAttribute('aria-label', 'Remove')
      rm.addEventListener('click', () => {
        delete params[state.key]
        as.destroy()
        const ix = self._widgets.indexOf(as)
        if (ix >= 0) self._widgets.splice(ix, 1)
        row.remove()
        emit('remove', state.key)
        refreshAddEnabled()
      })

      row.appendChild(el)
      row.appendChild(rm)
      rowsEl.appendChild(row)
    }

    const refreshAddEnabled = () => {
      const used = new Set(Object.keys(params))
      const canAdd = baseItems.some(it => !used.has(it.key))
      addBtn.disabled = !canAdd
    }

    const addRow = () => {
      const used = new Set(Object.keys(params))
      const next = baseItems.find(it => !used.has(it.key))
      if (!next) return
      const def = defaultValueForItem(next)
      params[next.key] = def !== undefined ? def : ''
      appendRow(next.key)
      emit('add', next.key)
      refreshAddEnabled()
    }

    addBtn.addEventListener('click', () => addRow())

    for (const key of Object.keys(params)) {
      appendRow(key)
    }

    refreshAddEnabled()

    root.appendChild(rowsEl)
    root.appendChild(addBtn)

    return {
      root,
      destroy: () => {
        destroyAllWidgets()
        rowsEl.replaceChildren()
      }
    }
  }
}
