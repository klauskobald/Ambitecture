const STORAGE_PREFIX = 'ambitecture.surface-v2.layoutSplit.'
const MIN_PANEL_PX = 80

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
  const sizeProp = isHorizontal ? 'width' : 'height'
  const storageKey = `${STORAGE_PREFIX}${layoutId}.${nodePath}`

  const grips = [...container.querySelectorAll('.layout-split-grip')]
  if (grips.length !== panels.length - 1) return

  const fractions = loadFractions(panels.length, storageKey)
  applyFractions(panels, fractions, isHorizontal)

  for (let i = 0; i < grips.length; i++) {
    const grip = /** @type {HTMLElement} */ (grips[i])
    const left = panels[i]
    const right = panels[i + 1]
    if (!left || !right) continue

    grip.addEventListener('pointerdown', e => {
      if (e.button !== 0) return
      e.preventDefault()
      grip.setPointerCapture(e.pointerId)

      const containerRect = container.getBoundingClientRect()
      const total = isHorizontal ? containerRect.width : containerRect.height
      const gripSize = grip.getBoundingClientRect()[sizeProp]
      const avail = Math.max(
        MIN_PANEL_PX * panels.length,
        total - gripSize * grips.length
      )

      const startLeft = left.getBoundingClientRect()[sizeProp]
      const startCoord = isHorizontal ? e.clientX : e.clientY

      /**
       * @param {PointerEvent} ev
       */
      function onMove (ev) {
        const coord = isHorizontal ? ev.clientX : ev.clientY
        const origin = isHorizontal ? containerRect.left : containerRect.top
        let leftPx = startLeft + (coord - startCoord)
        leftPx = Math.min(
          avail - MIN_PANEL_PX,
          Math.max(MIN_PANEL_PX, leftPx)
        )
        const rightPx = avail - leftPx
        left.style.flex = `0 0 ${leftPx}px`
        right.style.flex = `0 0 ${rightPx}px`
      }

      /**
       * @param {PointerEvent} ev
       */
      function onUp (ev) {
        grip.releasePointerCapture(ev.pointerId)
        grip.removeEventListener('pointermove', onMove)
        grip.removeEventListener('pointerup', onUp)
        grip.removeEventListener('pointercancel', onUp)
        persistFractions(panels, avail, storageKey, isHorizontal)
      }

      grip.addEventListener('pointermove', onMove)
      grip.addEventListener('pointerup', onUp)
      grip.addEventListener('pointercancel', onUp)
    })
  }

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      const containerRect = container.getBoundingClientRect()
      const total = isHorizontal ? containerRect.width : containerRect.height
      const gripSize = grips.reduce(
        (sum, g) => sum + g.getBoundingClientRect()[sizeProp],
        0
      )
      const avail = Math.max(
        MIN_PANEL_PX * panels.length,
        total - gripSize
      )
      const stored = loadFractions(panels.length, storageKey)
      applyFractions(panels, stored, isHorizontal, avail)
    })
    ro.observe(container)
  }
}

/**
 * @param {number} count
 * @param {string} key
 * @returns {number[]}
 */
function loadFractions (count, key) {
  const equal = 1 / count
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return Array.from({ length: count }, () => equal)
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length !== count) {
      return Array.from({ length: count }, () => equal)
    }
    const nums = parsed.map(Number)
    if (nums.some(n => !Number.isFinite(n) || n <= 0)) {
      return Array.from({ length: count }, () => equal)
    }
    const sum = nums.reduce((a, b) => a + b, 0)
    if (sum <= 0) return Array.from({ length: count }, () => equal)
    return nums.map(n => n / sum)
  } catch {
    return Array.from({ length: count }, () => equal)
  }
}

/**
 * @param {HTMLElement[]} panels
 * @param {number[]} fractions
 * @param {boolean} isHorizontal
 * @param {number} [availTotal]
 */
function applyFractions (panels, fractions, isHorizontal, availTotal) {
  const container = panels[0]?.parentElement
  if (!container) return
  const containerRect = container.getBoundingClientRect()
  const total = availTotal ?? (isHorizontal ? containerRect.width : containerRect.height)
  const grips = container.querySelectorAll('.layout-split-grip')
  let gripTotal = 0
  for (const g of grips) {
    const r = g.getBoundingClientRect()
    gripTotal += isHorizontal ? r.width : r.height
  }
  const avail = Math.max(MIN_PANEL_PX * panels.length, total - gripTotal)
  for (let i = 0; i < panels.length; i++) {
    const px = Math.max(MIN_PANEL_PX, Math.round(avail * fractions[i]))
    panels[i].style.flex = `0 0 ${px}px`
  }
}

/**
 * @param {HTMLElement[]} panels
 * @param {number} avail
 * @param {string} key
 * @param {boolean} isHorizontal
 */
function persistFractions (panels, avail, key, isHorizontal) {
  if (avail <= 0) return
  const fractions = panels.map(p => {
    const r = p.getBoundingClientRect()
    const size = isHorizontal ? r.width : r.height
    return size / avail
  })
  try {
    localStorage.setItem(key, JSON.stringify(fractions))
  } catch {
    /* ignore */
  }
}
