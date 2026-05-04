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
    /** @type {{ pointerId: number, fromIndex: number, item: Record<string, unknown>, row: HTMLElement } | null} */
    let dragState = null
    const clearDropMarkers = () => {
      for (const node of host.querySelectorAll('.array-sort-row')) {
        node.classList.remove('array-sort-row--drop-before', 'array-sort-row--drop-after')
      }
    }
    const resolveDropTarget = (clientX, clientY) => {
      const el = document.elementFromPoint(clientX, clientY)
      const row = el instanceof Element ? el.closest('.array-sort-row') : null
      if (!(row instanceof HTMLElement)) return null
      const rect = row.getBoundingClientRect()
      const dropBefore = clientY < (rect.top + rect.height / 2)
      const anchor = parseInt(row.dataset.index ?? '', 10)
      if (Number.isNaN(anchor)) return null
      return { row, anchor, dropBefore }
    }
    const applyDropMarker = (clientX, clientY) => {
      clearDropMarkers()
      const target = resolveDropTarget(clientX, clientY)
      if (!target) return null
      target.row.classList.add(target.dropBefore ? 'array-sort-row--drop-before' : 'array-sort-row--drop-after')
      return target
    }
    const finalizeDrag = (clientX, clientY) => {
      if (!dragState) return
      const { fromIndex, row, item } = dragState
      const target = resolveDropTarget(clientX, clientY)
      row.classList.remove('array-sort-row--dragging')
      clearDropMarkers()
      callbackLifecycle(item, 'hasBeenDragged')
      dragState = null
      if (!target) return
      let to = target.anchor + (target.dropBefore ? 0 : 1)
      if (fromIndex < to) to -= 1
      if (fromIndex === to) return
      const [moved] = ordered.splice(fromIndex, 1)
      ordered.splice(to, 0, moved)
      renumberSortKeysContiguous(ordered, key)
      this._liveOrder = ordered
      render()
      onReorder(ordered)
    }

    const render = () => {
      host.replaceChildren()
      ordered.forEach((item, index) => {
        const row = document.createElement('div')
        row.className = 'array-sort-row'
        row.dataset.index = String(index)

        row.addEventListener('pointerdown', e => {
          if (e.button !== 0) return
          if (dragState) return
          e.preventDefault()
          row.classList.add('array-sort-row--dragging')
          row.setPointerCapture?.(e.pointerId)
          dragState = { pointerId: e.pointerId, fromIndex: index, item, row }
          callbackLifecycle(item, 'willBeDragged')
        })

        row.addEventListener('pointermove', e => {
          if (!dragState || dragState.pointerId !== e.pointerId) return
          e.preventDefault()
          applyDropMarker(e.clientX, e.clientY)
        })

        row.addEventListener('pointerup', e => {
          if (!dragState || dragState.pointerId !== e.pointerId) return
          e.preventDefault()
          if (row.hasPointerCapture?.(e.pointerId)) row.releasePointerCapture(e.pointerId)
          finalizeDrag(e.clientX, e.clientY)
        })

        row.addEventListener('pointercancel', e => {
          if (!dragState || dragState.pointerId !== e.pointerId) return
          if (row.hasPointerCapture?.(e.pointerId)) row.releasePointerCapture(e.pointerId)
          finalizeDrag(e.clientX, e.clientY)
        })

        const inner = callbackDisplay(item)
        row.appendChild(inner)
        host.appendChild(row)
      })
    }

    render()
  }
}
