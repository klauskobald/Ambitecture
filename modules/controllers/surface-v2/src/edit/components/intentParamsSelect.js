import { AugmentedSelect } from './augmentedSelect.js'
import { resolveIntentDescriptorUiKind } from '../../core/systemCapabilities.js'

/**
 * @typedef {object} IntentParamsLifecycle
 * @property {'add'|'remove'|'change'} phase
 * @property {string} [key]
 * @property {Record<string, unknown>} params
 */

/**
 * When `systemCapabilities.intentProperties[].ignoreInParamsEditor` is true, the property
 * is omitted from the input assign params editor (still available elsewhere in the UI).
 *
 * @param {unknown} d
 * @returns {boolean}
 */
export function isExcludedFromParamsEditor (d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return false
  return (
    /** @type {Record<string, unknown>} */ (d).ignoreInParamsEditor === true
  )
}

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

  const components = normalizeComponents(rec.components)
  if (components) {
    return {
      key: dotKey,
      name,
      display: 'components',
      descriptor: rec,
      components
    }
  }

  const uiKind = resolveIntentDescriptorUiKind(rec)
  /** @type {'slider'|'dropdown'|'text'|'json'} */
  let display = 'json'
  if (uiKind === 'scalar') display = 'slider'
  else if (
    uiKind === 'pills' ||
    (uiKind === 'string' &&
      Array.isArray(rec.options) &&
      rec.options.length > 0)
  ) {
    display = 'dropdown'
  } else if (uiKind === 'string') display = 'text'
  else if (uiKind === 'color' || uiKind === 'vector3') display = 'json'

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
 * @param {unknown} raw
 * @returns {import('./augmentedSelect.js').AugmentedComponent[] | null}
 */
function normalizeComponents (raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null
  /** @type {import('./augmentedSelect.js').AugmentedComponent[]} */
  const out = []
  for (const c of raw) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) continue
    const rec = /** @type {Record<string, unknown>} */ (c)
    if (rec.key === undefined || rec.key === null) continue
    const key = String(rec.key)
    const name = String(rec.name ?? key)
    out.push({ key, name, descriptor: rec })
  }
  return out.length > 0 ? out : null
}

/**
 * @param {import('./augmentedSelect.js').AugmentedItem | undefined} item
 * @returns {string[]}
 */
function paramKeysForLogical (item) {
  if (!item || !item.key) return []
  if (item.display === 'components' && Array.isArray(item.components)) {
    const out = [item.key]
    for (const c of item.components) out.push(`${item.key}.${c.key}`)
    return out
  }
  return [item.key]
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

    /** @type {Set<string>} */
    const excludedDotKeys = new Set()
    for (const d of descriptors) {
      if (!isExcludedFromParamsEditor(d)) continue
      if (!d || typeof d !== 'object' || Array.isArray(d)) continue
      const dk = String(
        /** @type {Record<string, unknown>} */ (d).dotKey ?? ''
      ).trim()
      if (dk.length > 0) excludedDotKeys.add(dk)
    }

    /** @type {import('./augmentedSelect.js').AugmentedItem[]} */
    const baseItems = []
    for (const d of descriptors) {
      if (isExcludedFromParamsEditor(d)) continue
      const it = descriptorToAugmentedItem(d)
      if (it.key.length > 0) baseItems.push(it)
    }

    /** @type {import('./augmentedSelect.js').AugmentedItem[]} */
    const items = [...baseItems]
    const itemByKey = new Map(items.map(it => [it.key, it]))

    /** Param keys consumed by descriptor rows (logical or per-component flat). */
    const consumedFlatKeys = new Set()
    /** Logical keys that have data in params and should seed a row on load. */
    const seedLogicalKeys = []
    for (const it of baseItems) {
      const flatKeys = paramKeysForLogical(it)
      const hasData = flatKeys.some(k => params[k] !== undefined)
      if (hasData) seedLogicalKeys.push(it.key)
      for (const k of flatKeys) consumedFlatKeys.add(k)
    }

    /** Orphan params keys (no matching descriptor) — keep current "json" fallback. */
    const orphanKeys = []
    for (const k of Object.keys(params)) {
      if (excludedDotKeys.has(k)) continue
      if (consumedFlatKeys.has(k)) continue
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
      orphanKeys.push(k)
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

    const currentLogicalKeys = () => {
      const s = new Set()
      for (const w of self._widgets) {
        const k = w.getSelectedKey()
        if (k) s.add(k)
      }
      return s
    }

    const usedKeysExcept = except => {
      const s = currentLogicalKeys()
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
          const prevItem = itemByKey.get(prev)
          for (const k of paramKeysForLogical(prevItem)) delete params[k]
          state.key = next
          const nextItem = itemByKey.get(next)
          if (nextItem?.display !== 'components') {
            const def = nextItem ? defaultValueForItem(nextItem) : undefined
            params[next] = def !== undefined ? def : ''
          }
          as.setDisabledKeys(usedKeysExcept(state.key))
        },
        writeComponents: (checkedKeys, values) => {
          const item = itemByKey.get(state.key)
          if (!item?.components) return
          const allCompKeys = item.components.map(c => String(c.key))
          delete params[state.key]
          for (const ck of allCompKeys) delete params[`${state.key}.${ck}`]
          if (
            checkedKeys.length === allCompKeys.length &&
            checkedKeys.length > 0
          ) {
            params[state.key] = allCompKeys.map(ck => values[ck])
          } else {
            for (const ck of checkedKeys) {
              params[`${state.key}.${ck}`] = values[ck]
            }
          }
        },
        readComponents: () => {
          const item = itemByKey.get(state.key)
          /** @type {Set<string>} */
          const checked = new Set()
          /** @type {Record<string, unknown>} */
          const values = {}
          if (!item?.components) return { checked, values }
          const allCompKeys = item.components.map(c => String(c.key))
          const arr = params[state.key]
          if (Array.isArray(arr)) {
            allCompKeys.forEach((ck, i) => {
              checked.add(ck)
              values[ck] = arr[i]
            })
          } else {
            for (const ck of allCompKeys) {
              const v = params[`${state.key}.${ck}`]
              if (v !== undefined) {
                checked.add(ck)
                values[ck] = v
              }
            }
          }
          return { checked, values }
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
        const it = itemByKey.get(state.key)
        for (const k of paramKeysForLogical(it)) delete params[k]
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
      const used = currentLogicalKeys()
      const canAdd = baseItems.some(it => !used.has(it.key))
      addBtn.disabled = !canAdd
    }

    const addRow = () => {
      const used = currentLogicalKeys()
      const next = baseItems.find(it => !used.has(it.key))
      if (!next) return
      if (next.display !== 'components') {
        const def = defaultValueForItem(next)
        params[next.key] = def !== undefined ? def : ''
      }
      appendRow(next.key)
      emit('add', next.key)
      refreshAddEnabled()
    }

    addBtn.addEventListener('click', () => addRow())

    for (const dk of seedLogicalKeys) {
      appendRow(dk)
    }
    for (const ok of orphanKeys) {
      appendRow(ok)
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
