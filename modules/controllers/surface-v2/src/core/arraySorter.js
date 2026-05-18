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
    /** @type {{ pointerId: number, fromIndex: number, item: Record<string, unknown>, row: HTMLElement, handle: HTMLButtonElement, ghost: HTMLElement | null, dx: number, dy: number, lastClientX: number, lastClientY: number } | null} */
    let dragState = null
    /** @type {number} */
    let edgeScrollRaf = 0
    /**
     * Scroll speed per frame when the pointer is past the host's top/bottom edge (px).
     * Slow near the edge, ramps up with distance (quadratic + small linear term).
     * @param {number} overPx
     */
    const scrollStepForOverhang = (overPx) => {
      const o = Math.max(0, overPx)
      const minStep = 0.55
      const linear = 0.12
      const quad = 0.038
      const maxStep = 50
      return Math.min(maxStep, minStep + linear * o + quad * o * o)
    }
    const cancelEdgeScroll = () => {
      if (edgeScrollRaf !== 0) {
        cancelAnimationFrame(edgeScrollRaf)
        edgeScrollRaf = 0
      }
    }
    const edgeScrollLoop = () => {
      edgeScrollRaf = 0
      if (!dragState) return
      const { lastClientX, lastClientY } = dragState
      const rect = host.getBoundingClientRect()
      let delta = 0
      if (lastClientY < rect.top) {
        delta = -scrollStepForOverhang(rect.top - lastClientY)
      } else if (lastClientY > rect.bottom) {
        delta = scrollStepForOverhang(lastClientY - rect.bottom)
      }
      if (delta !== 0) {
        const maxScroll = Math.max(0, host.scrollHeight - host.clientHeight)
        host.scrollTop = Math.max(0, Math.min(maxScroll, host.scrollTop + delta))
      }
      updateGhostPosition(lastClientX, lastClientY)
      applyDropMarker(lastClientX, lastClientY)
      const stillOutside = lastClientY < rect.top || lastClientY > rect.bottom
      if (dragState && stillOutside) {
        edgeScrollRaf = requestAnimationFrame(edgeScrollLoop)
      }
    }
    const syncEdgeScroll = () => {
      if (!dragState) return
      const { lastClientY } = dragState
      const rect = host.getBoundingClientRect()
      const outside = lastClientY < rect.top || lastClientY > rect.bottom
      if (outside && edgeScrollRaf === 0) {
        edgeScrollRaf = requestAnimationFrame(edgeScrollLoop)
      }
      if (!outside) cancelEdgeScroll()
    }
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
    const removeGhost = () => {
      const ghost = dragState?.ghost
      if (!ghost) return
      ghost.remove()
      if (dragState) dragState.ghost = null
    }
    const updateGhostPosition = (clientX, clientY) => {
      const ghost = dragState?.ghost
      if (!ghost || !dragState) return
      ghost.style.left = `${Math.round(clientX - dragState.dx)}px`
      ghost.style.top = `${Math.round(clientY - dragState.dy)}px`
    }
    const finalizeDrag = (clientX, clientY) => {
      if (!dragState) return
      cancelEdgeScroll()
      const { fromIndex, row, item } = dragState
      const target = resolveDropTarget(clientX, clientY)
      row.classList.remove('array-sort-row--dragging')
      clearDropMarkers()
      removeGhost()
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

        const handle = document.createElement('button')
        handle.type = 'button'
        handle.className = 'array-sort-row__handle'
        handle.setAttribute('aria-label', 'Drag to reorder')

        handle.addEventListener('pointerdown', e => {
          if (e.button !== 0) return
          if (dragState) return
          e.preventDefault()
          const rect = row.getBoundingClientRect()
          const ghost = row.cloneNode(true)
          if (ghost instanceof HTMLElement) {
            ghost.classList.add('array-sort-ghost')
            ghost.style.width = `${Math.round(rect.width)}px`
            ghost.style.left = `${Math.round(rect.left)}px`
            ghost.style.top = `${Math.round(rect.top)}px`
            document.body.appendChild(ghost)
          }
          row.classList.add('array-sort-row--dragging')
          handle.setPointerCapture?.(e.pointerId)
          dragState = {
            pointerId: e.pointerId,
            fromIndex: index,
            item,
            row,
            handle,
            ghost: ghost instanceof HTMLElement ? ghost : null,
            dx: e.clientX - rect.left,
            dy: e.clientY - rect.top,
            lastClientX: e.clientX,
            lastClientY: e.clientY,
          }
          updateGhostPosition(e.clientX, e.clientY)
          callbackLifecycle(item, 'willBeDragged')
        })

        handle.addEventListener('pointermove', e => {
          if (!dragState || dragState.pointerId !== e.pointerId) return
          e.preventDefault()
          dragState.lastClientX = e.clientX
          dragState.lastClientY = e.clientY
          updateGhostPosition(e.clientX, e.clientY)
          applyDropMarker(e.clientX, e.clientY)
          syncEdgeScroll()
        })

        handle.addEventListener('pointerup', e => {
          if (!dragState || dragState.pointerId !== e.pointerId) return
          e.preventDefault()
          if (handle.hasPointerCapture?.(e.pointerId)) handle.releasePointerCapture(e.pointerId)
          finalizeDrag(e.clientX, e.clientY)
        })

        handle.addEventListener('pointercancel', e => {
          if (!dragState || dragState.pointerId !== e.pointerId) return
          if (handle.hasPointerCapture?.(e.pointerId)) handle.releasePointerCapture(e.pointerId)
          finalizeDrag(e.clientX, e.clientY)
        })

        const inner = callbackDisplay(item)
        row.appendChild(inner)
        row.appendChild(handle)
        host.appendChild(row)
      })
    }

    render()
  }
}
