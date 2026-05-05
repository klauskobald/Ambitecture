/** Persisted height for #pane-host (browser localStorage only). */

const STORAGE_KEY = 'ambitecture.surface-v1.paneHostHeightPx'

/** Minimum pane-host height while resizing (px). */
const MIN_PANE_PX = 100

/** Class on `.app-main` while a user-defined pane height is active — lets `#sim-area` shrink below `--sim-stack-min-height`. */
const MAIN_PANE_SPLIT_CLASS = 'app-main--pane-host-sized'

export function initPaneHostResize () {
  const paneHost = document.getElementById('pane-host')
  const grip = document.getElementById('pane-host-resize-grip')
  const simArea = document.getElementById('sim-area')
  const appMain = document.querySelector('.app-main')
  if (!paneHost || !grip || !simArea || !appMain) return

  /**
   * @returns {number | null}
   */
  function parseStored () {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw === null) return null
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    } catch {
      return null
    }
  }

  /**
   * @returns {number}
   */
  function maxPanePx () {
    const mainRect = appMain.getBoundingClientRect()
    const styles = getComputedStyle(appMain)
    const gapRaw = styles.rowGap || styles.gap || '0'
    const gap = parseFloat(gapRaw) || 0
    // All of `.app-main` minus the flex gap between sim and pane (sim may shrink to ~0 via CSS override).
    let avail = Math.floor(mainRect.height - gap)
    if (!Number.isFinite(avail)) avail = MIN_PANE_PX
    return Math.max(MIN_PANE_PX, avail)
  }

  /**
   * @param {number} h
   * @returns {number}
   */
  function clampHeight (h) {
    const hi = maxPanePx()
    return Math.min(hi, Math.max(MIN_PANE_PX, Math.round(h)))
  }

  /**
   * @param {number} h
   */
  function applyHeightPx (h) {
    appMain.classList.add(MAIN_PANE_SPLIT_CLASS)
    paneHost.style.flexGrow = '0'
    paneHost.style.flexShrink = '0'
    paneHost.style.flexBasis = 'auto'
    paneHost.style.height = `${h}px`
  }

  function persistCurrentHeight () {
    const h = parseFloat(paneHost.style.height)
    if (!Number.isFinite(h)) return
    try {
      localStorage.setItem(STORAGE_KEY, String(Math.round(h)))
    } catch {
      /* ignore quota / private mode */
    }
  }

  function clampAppliedHeightToViewport () {
    if (simArea.hidden) return
    if (!paneHost.style.height) return
    const cur = parseFloat(paneHost.style.height)
    if (!Number.isFinite(cur)) return
    applyHeightPx(clampHeight(cur))
    persistCurrentHeight()
  }

  const stored = parseStored()
  if (stored !== null) applyHeightPx(clampHeight(stored))

  window.addEventListener('resize', clampAppliedHeightToViewport)

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => clampAppliedHeightToViewport())
    ro.observe(appMain)
  }

  grip.addEventListener('pointerdown', e => {
    if (simArea.hidden) return
    if (e.button !== 0) return
    e.preventDefault()
    grip.setPointerCapture(e.pointerId)

    const startY = e.clientY
    const rectH = paneHost.getBoundingClientRect().height
    let startH = Number.isFinite(rectH) ? rectH : MIN_PANE_PX
    if (!paneHost.style.height) startH = clampHeight(startH)

    /**
     * @param {PointerEvent} ev
     */
    function onMove (ev) {
      const dy = ev.clientY - startY
      applyHeightPx(clampHeight(startH - dy))
    }

    /**
     * @param {PointerEvent} ev
     */
    function onUp (ev) {
      grip.releasePointerCapture(ev.pointerId)
      grip.removeEventListener('pointermove', onMove)
      grip.removeEventListener('pointerup', onUp)
      grip.removeEventListener('pointercancel', onUp)
      persistCurrentHeight()
    }

    grip.addEventListener('pointermove', onMove)
    grip.addEventListener('pointerup', onUp)
    grip.addEventListener('pointercancel', onUp)
  })
}
