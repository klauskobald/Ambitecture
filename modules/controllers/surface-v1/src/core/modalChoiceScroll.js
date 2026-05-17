/** Persisted scrollTop for modal choice lists (browser localStorage only). */

const STORAGE_PREFIX = 'ambitecture.surface-v1.modalChoiceScroll.'

const SCROLL_SAVE_DEBOUNCE_MS = 100

/**
 * @param {string} scrollKey
 * @returns {string | null}
 */
function normalizeScrollKey (scrollKey) {
  const k = String(scrollKey ?? '').trim()
  return k.length > 0 ? k : null
}

/**
 * @param {string} scrollKey
 * @returns {string | null}
 */
export function readModalChoiceScrollTop (scrollKey) {
  const key = normalizeScrollKey(scrollKey)
  if (!key) return null
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    if (raw === null) return null
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) return null
    return n
  } catch {
    return null
  }
}

/**
 * @param {string} scrollKey
 * @param {number} scrollTop
 */
export function writeModalChoiceScrollTop (scrollKey, scrollTop) {
  const key = normalizeScrollKey(scrollKey)
  if (!key) return
  if (!Number.isFinite(scrollTop)) return
  try {
    localStorage.setItem(
      STORAGE_PREFIX + key,
      String(Math.max(0, Math.round(scrollTop)))
    )
  } catch {
    // ignore quota / private mode
  }
}

/**
 * @param {HTMLElement} scrollEl
 * @param {string} scrollKey
 */
export function captureModalChoiceScroll (scrollEl, scrollKey) {
  if (!normalizeScrollKey(scrollKey)) return
  writeModalChoiceScrollTop(scrollKey, scrollEl.scrollTop)
}

/**
 * @param {HTMLElement} scrollEl
 * @param {string} scrollKey
 */
export function restoreModalChoiceScroll (scrollEl, scrollKey) {
  const saved = readModalChoiceScrollTop(scrollKey)
  if (saved === null) return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight)
      scrollEl.scrollTop = Math.min(saved, maxScroll)
    })
  })
}

/**
 * Debounced scroll listener; call returned function to remove listener.
 * @param {HTMLElement} scrollEl
 * @param {string} scrollKey
 * @returns {() => void}
 */
export function bindModalChoiceScrollPersistence (scrollEl, scrollKey) {
  const key = normalizeScrollKey(scrollKey)
  if (!key) return () => {}

  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null

  const onScroll = () => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      writeModalChoiceScrollTop(key, scrollEl.scrollTop)
    }, SCROLL_SAVE_DEBOUNCE_MS)
  }

  scrollEl.addEventListener('scroll', onScroll, { passive: true })

  return () => {
    if (timer !== null) clearTimeout(timer)
    scrollEl.removeEventListener('scroll', onScroll)
  }
}

/**
 * Restore saved scroll and bind debounced persistence.
 * @param {HTMLElement} scrollEl
 * @param {string} scrollKey
 * @returns {() => void}
 */
export function attachModalChoiceScrollPersistence (scrollEl, scrollKey) {
  restoreModalChoiceScroll(scrollEl, scrollKey)
  return bindModalChoiceScrollPersistence(scrollEl, scrollKey)
}
