/**
 * Generic list sort by a numeric index property on each item (default `_sortIdx`).
 * Optional drag UI writes indices in place on the same object references.
 */

/** Default sort key on controller input records for Perform button order. */
export const DEFAULT_PERFORM_INPUT_SORT_KEY = '_sortIdx'

/**
 * @param {Record<string, unknown>[]} items
 * @param {string} sortKeyProp
 */
export function normalizeUndefinedSortKeys (items, sortKeyProp) {
  let max = -1
  for (const item of items) {
    const v = item[sortKeyProp]
    if (typeof v === 'number' && !Number.isNaN(v)) max = Math.max(max, v)
  }
  for (const item of items) {
    const v = item[sortKeyProp]
    if (typeof v !== 'number' || Number.isNaN(v)) {
      max += 1
      item[sortKeyProp] = max
    }
  }
}

/**
 * @param {Record<string, unknown>[]} orderedItems
 * @param {string} sortKeyProp
 */
export function renumberSortKeysContiguous (orderedItems, sortKeyProp) {
  orderedItems.forEach((item, i) => {
    item[sortKeyProp] = i
  })
}

export class ArraySorter {
  /**
   * @param {Record<string, unknown>[]} rawDataList same references as graph (mutated in place)
   * @param {string} [sortKeyProp]
   */
  constructor (rawDataList, sortKeyProp = DEFAULT_PERFORM_INPUT_SORT_KEY) {
    this._list = rawDataList
    this._sortKeyProp = sortKeyProp
    /** @type {Record<string, unknown>[] | null} */
    this._liveOrder = null
  }

  /** @returns {Record<string, unknown>[]} snapshot of last dialog order (empty if no dialog) */
  getLiveOrder () {
    return this._liveOrder ? [...this._liveOrder] : []
  }

  /** @returns {string} */
  getSortKeyProp () {
    return this._sortKeyProp
  }

  /**
   * @returns {Record<string, unknown>[]}
   */
  getItemsSorted () {
    const key = this._sortKeyProp
    return [...this._list].sort((a, b) => {
      const av = a[key]
      const bv = b[key]
      const an = typeof av === 'number' && !Number.isNaN(av) ? av : Number.POSITIVE_INFINITY
      const bn = typeof bv === 'number' && !Number.isNaN(bv) ? bv : Number.POSITIVE_INFINITY
      if (an !== bn) return an - bn
      const ag = String(a.guid ?? '')
      const bg = String(b.guid ?? '')
      return ag.localeCompare(bg)
    })
  }

  /**
   * Renders draggable rows into `host`, mutates `ordered` and item sort keys on reorder.
   *
   * @param {HTMLElement} host row container
   * @param {(item: Record<string, unknown>) => HTMLElement | DocumentFragment} callbackDisplay
   * @param {(item: Record<string, unknown>, phase: 'willBeDragged' | 'hasBeenDragged') => void} callbackLifecycle
   * @param {(ordered: Record<string, unknown>[]) => void} onReorder indices already written; caller pushes graph + notifies
   */
  displaySortDialog (host, callbackDisplay, callbackLifecycle, onReorder) {
    const key = this._sortKeyProp
    const ordered = [...this.getItemsSorted()]
    this._liveOrder = ordered
    normalizeUndefinedSortKeys(ordered, key)
    renumberSortKeysContiguous(ordered, key)
    onReorder(ordered)

    const render = () => {
      host.replaceChildren()
      ordered.forEach((item, index) => {
        const row = document.createElement('div')
        row.className = 'array-sort-row'
        row.draggable = true
        row.dataset.index = String(index)

        row.addEventListener('dragstart', e => {
          if (!e.dataTransfer) return
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', String(index))
          row.classList.add('array-sort-row--dragging')
          callbackLifecycle(item, 'willBeDragged')
        })

        row.addEventListener('dragend', () => {
          row.classList.remove('array-sort-row--dragging')
          callbackLifecycle(item, 'hasBeenDragged')
        })

        row.addEventListener('dragover', e => {
          e.preventDefault()
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
        })

        row.addEventListener('drop', e => {
          e.preventDefault()
          const rawFrom = e.dataTransfer?.getData('text/plain') ?? ''
          const from = parseInt(rawFrom, 10)
          const to = parseInt(row.dataset.index ?? '', 10)
          if (Number.isNaN(from) || Number.isNaN(to) || from === to) return
          const [moved] = ordered.splice(from, 1)
          ordered.splice(to, 0, moved)
          renumberSortKeysContiguous(ordered, key)
          this._liveOrder = ordered
          render()
          onReorder(ordered)
        })

        const inner = callbackDisplay(item)
        row.appendChild(inner)
        host.appendChild(row)
      })
    }

    render()
  }
}
