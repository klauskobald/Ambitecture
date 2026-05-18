import {
  loadSplitFractions,
  saveSplitFractions
} from './layoutSplitState.js'

const MIN_PANEL_PX = 80

/**
 * Grips owned by this box only — not nested hbox/vbox splits inside panels.
 * @param {HTMLElement} container
 * @returns {HTMLElement[]}
 */
function directSplitGrips (container) {
  return [...container.children].filter(el =>
    el.classList.contains('layout-split-grip')
  )
}

/**
 * @param {object} opts
 * @param {'horizontal' | 'vertical'} opts.axis
 * @param {HTMLElement} opts.container
 * @param {HTMLElement[]} opts.panels
 * @param {string} opts.layoutId
 * @param {string} opts.nodePath
 */
export function attachSplitResize (opts) {
  const { axis, container, panels, layoutId, nodePath } = opts
  if (panels.length < 2) return

  const isHorizontal = axis === 'horizontal'

  const grips = directSplitGrips(container)
  if (grips.length !== panels.length - 1) return

  /**
   * @returns {number}
   */
  function gripTotalPx () {
    let sum = 0
    for (const g of grips) {
      const r = g.getBoundingClientRect()
      sum += isHorizontal ? r.width : r.height
    }
    return sum
  }

  /**
   * @returns {number}
   */
  function availablePx () {
    const containerRect = container.getBoundingClientRect()
    const total = isHorizontal ? containerRect.width : containerRect.height
    return Math.max(MIN_PANEL_PX * panels.length, total - gripTotalPx())
  }

  /**
   * @returns {number[]}
   */
  function readPanelSizesPx () {
    return panels.map(p => {
      const r = p.getBoundingClientRect()
      const size = isHorizontal ? r.width : r.height
      return Number.isFinite(size) ? size : MIN_PANEL_PX
    })
  }

  /**
   * @param {number[]} sizes
   */
  function applyPanelSizesPx (sizes) {
    for (let i = 0; i < panels.length; i++) {
      const px = sizes[i]
      if (px === undefined || !Number.isFinite(px)) continue
      panels[i].style.flex = `0 0 ${Math.round(px)}px`
    }
  }

  function applyStoredFractions () {
    const fractions = loadSplitFractions(layoutId, nodePath, panels.length)
    applyFractionsFlex(panels, fractions)
  }

  function persistCurrentFractions () {
    const sizes = readPanelSizesPx()
    const sum = sizes.reduce((a, b) => a + b, 0)
    if (sum <= 0) return
    const fractions = sizes.map(s => s / sum)
    saveSplitFractions(layoutId, nodePath, fractions)
  }

  let isDragging = false

  applyStoredFractions()

  requestAnimationFrame(() => {
    applyStoredFractions()
  })

  for (let gripIndex = 0; gripIndex < grips.length; gripIndex++) {
    const grip = /** @type {HTMLElement} */ (grips[gripIndex])
    const panelBefore = panels[gripIndex]
    const panelAfter = panels[gripIndex + 1]
    if (!panelBefore || !panelAfter) continue

    grip.addEventListener('pointerdown', e => {
      if (e.button !== 0) return
      e.preventDefault()
      grip.setPointerCapture(e.pointerId)
      isDragging = true

      const startSizes = readPanelSizesPx()
      const pairTotal = startSizes[gripIndex] + startSizes[gripIndex + 1]
      const minPair = MIN_PANEL_PX * 2
      const effectivePairTotal = Math.max(minPair, pairTotal)

      const startCoord = isHorizontal ? e.clientX : e.clientY
      const startBeforePx = startSizes[gripIndex]

      /**
       * @param {PointerEvent} ev
       */
      function onMove (ev) {
        const coord = isHorizontal ? ev.clientX : ev.clientY
        const delta = coord - startCoord
        let beforePx = startBeforePx + delta
        beforePx = Math.min(
          effectivePairTotal - MIN_PANEL_PX,
          Math.max(MIN_PANEL_PX, beforePx)
        )
        const afterPx = effectivePairTotal - beforePx

        const sizes = [...startSizes]
        sizes[gripIndex] = beforePx
        sizes[gripIndex + 1] = afterPx
        applyPanelSizesPx(sizes)
      }

      /**
       * @param {PointerEvent} ev
       */
      function onUp (ev) {
        grip.releasePointerCapture(ev.pointerId)
        grip.removeEventListener('pointermove', onMove)
        grip.removeEventListener('pointerup', onUp)
        grip.removeEventListener('pointercancel', onUp)
        isDragging = false
        persistCurrentFractions()
        applyStoredFractions()
      }

      grip.addEventListener('pointermove', onMove)
      grip.addEventListener('pointerup', onUp)
      grip.addEventListener('pointercancel', onUp)
    })
  }

  if (typeof ResizeObserver !== 'undefined') {
    let rafId = 0
    const ro = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        rafId = 0
        if (isDragging) return
        const avail = availablePx()
        if (avail <= MIN_PANEL_PX * panels.length) return
        applyStoredFractions()
      })
    })
    ro.observe(container)
  }
}

/**
 * @param {HTMLElement[]} panels
 * @param {number[]} fractions relative sizes (sum = 1)
 */
function applyFractionsFlex (panels, fractions) {
  for (let i = 0; i < panels.length; i++) {
    const grow = fractions[i] ?? 1 / panels.length
    panels[i].style.flex = `${grow} 1 0`
  }
}
