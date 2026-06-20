import { loadHelpContent, getHelpTopic } from './loadHelpContent.js'
import {
  loadHelpPanelGeometry,
  saveHelpPanelGeometry,
  loadHelpVisible,
  saveHelpVisible
} from './helpPanelState.js'
import { renderHelpText } from './renderHelpText.js'

/**
 * @typedef {object} ShowOptions
 * @property {string | HTMLElement} [host] registered host name or a raw element; switches to attached (non-floating) mode
 * @property {() => void} [onClose] invoked when the user dismisses the panel via its × control
 * @property {boolean} [force] open even when automatic help is toggled off (used by the manual ? button)
 * @property {boolean} [quiet] when the key has no topic, do nothing instead of showing the `no-help-available` fallback
 * @property {boolean} [_back] internal — back-navigation; do not push the current page onto the history stack
 * @property {number} [_scrollTop] internal — restore the body scroll position to this value after render
 */

const DEFAULT_FLOAT_WIDTH = 320
const DEFAULT_FLOAT_HEIGHT = 200
const OPEN_ICON_SIZE = 36

/** @type {Map<string, HTMLElement | (() => HTMLElement | null)>} */
const hosts = new Map()

/** @type {HTMLElement | null} */
let panelEl = null
/** @type {(() => void) | null} */
let currentOnClose = null
/** @type {Array<() => void>} */
let teardown = []
let hiding = false
/** Bumped on every show/hide so an in-flight (awaiting) `show` can detect it was superseded. */
let generation = 0

/**
 * Back-navigation stack. Each entry `{ key, scrollTop }` is the page you left.
 * Emptied when the panel opens fresh; appended to when `show` runs while the panel
 * is already open (link click, new auto-help). The Back button pops it.
 * @type {Array<{ key: string, scrollTop: number }>}
 */
let history = []
/** Topic key currently shown, captured so it can be pushed onto `history` on navigation. @type {string | null} */
let currentKey = null

/**
 * Master switch for *automatic* help. When off, programmatic `show` calls for
 * non-mandatory topics are skipped; manual opens (the ? button) and mandatory
 * topics always show.
 * @type {boolean}
 */
let helpVisible = loadHelpVisible()
/** @type {boolean} */
let currentTopicIsMandatory = false
/** @type {HTMLElement | null} */
let openIconEl = null

/**
 * @typedef {object} HelpConduit
 * @property {(name: string, args: string) => any | Promise<any>} callFunction
 */

/** @type {HelpConduit | null} */
let conduit = null

/**
 * Set the external communication channel.
 * @param {HelpConduit} c
 */
function setConduit (c) {
  conduit = c
}

// --- open icon (persistent ?, opens help; visible only while no panel is shown) -----

function ensureOpenIcon () {
  if (openIconEl) return
  openIconEl = document.createElement('button')
  openIconEl.type = 'button'
  openIconEl.className = 'help-open-icon'
  openIconEl.textContent = '❓'
  openIconEl.setAttribute('aria-label', 'Open help')
  openIconEl.title = 'Open help'
  openIconEl.addEventListener('click', onOpenClick)
  makeIconDraggable()
  updateOpenIconVisual()
  document.body.appendChild(openIconEl)
  positionOpenIconStandalone()
}

/** @type {boolean} */
let iconDidDrag = false

function makeIconDraggable () {
  if (!openIconEl) return

  /** @param {PointerEvent} e */
  const onDown = e => {
    if (e.button !== 0) return
    e.preventDefault()
    openIconEl.setPointerCapture(e.pointerId)
    const rect = openIconEl.getBoundingClientRect()
    const offsetX = e.clientX - rect.left
    const offsetY = e.clientY - rect.top
    iconDidDrag = false

    /** @param {PointerEvent} ev */
    const onMove = ev => {
      const dx = ev.clientX - e.clientX
      const dy = ev.clientY - e.clientY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) iconDidDrag = true
      const w = openIconEl.offsetWidth
      openIconEl.style.left = `${clampToViewport(ev.clientX - offsetX, w, window.innerWidth)}px`
      openIconEl.style.top = `${clampToViewport(ev.clientY - offsetY, OPEN_ICON_SIZE, window.innerHeight)}px`
    }
    /** @param {PointerEvent} ev */
    const onUp = ev => {
      openIconEl.releasePointerCapture(ev.pointerId)
      openIconEl.removeEventListener('pointermove', onMove)
      openIconEl.removeEventListener('pointerup', onUp)
      openIconEl.removeEventListener('pointercancel', onUp)
      if (iconDidDrag) {
        const stored = loadHelpPanelGeometry()
        const w = stored ? stored.w : DEFAULT_FLOAT_WIDTH
        const h = stored ? stored.h : DEFAULT_FLOAT_HEIGHT
        const iconRight = openIconEl.offsetLeft + openIconEl.offsetWidth
        saveHelpPanelGeometry({
          x: iconRight - w,
          y: openIconEl.offsetTop,
          w,
          h
        })
      }
    }
    openIconEl.addEventListener('pointermove', onMove)
    openIconEl.addEventListener('pointerup', onUp)
    openIconEl.addEventListener('pointercancel', onUp)
  }

  openIconEl.addEventListener('pointerdown', onDown)
}

function updateOpenIconVisual () {
  if (!openIconEl) return
  openIconEl.classList.toggle('help-open-icon--off', !helpVisible)
}

function setOpenIconHidden (hidden) {
  if (!openIconEl) return
  openIconEl.style.display = hidden ? 'none' : ''
}

function positionOpenIconStandalone () {
  if (!openIconEl) return
  const stored = loadHelpPanelGeometry()
  const anchorX = stored
    ? stored.x + stored.w
    : Math.round((window.innerWidth + DEFAULT_FLOAT_WIDTH) / 2)
  const anchorY = stored
    ? stored.y
    : Math.round((window.innerHeight - DEFAULT_FLOAT_HEIGHT) / 2)
  const iconW = openIconEl.offsetWidth
  openIconEl.style.left = `${clampToViewport(anchorX - iconW, iconW, window.innerWidth)}px`
  openIconEl.style.top = `${clampToViewport(anchorY, OPEN_ICON_SIZE, window.innerHeight)}px`
  openIconEl.style.right = 'auto'
  openIconEl.style.bottom = 'auto'
}

/** The ? button always opens help, regardless of the automatic-help toggle. */
function onOpenClick () {
  if (iconDidDrag) {
    iconDidDrag = false
    return
  }
  void show('index', { force: true })
}

// --- automatic-help toggle (lives inside the panel header) --------------------------

/**
 * Build the auto-help on/off switch that sits left of the × in the panel header.
 * Flipping it never closes the open panel — it only governs whether future
 * programmatic (non-mandatory) help is shown.
 * @returns {HTMLElement}
 */
function buildAutoHelpToggle () {
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'help-toggle'
  toggle.title = 'Automatic help on/off'
  const paint = () => {
    toggle.classList.toggle('help-toggle--off', !helpVisible)
    toggle.textContent = `Auto: ${helpVisible ? 'on' : 'off'}`
    toggle.setAttribute('aria-pressed', helpVisible ? 'true' : 'false')
  }
  toggle.addEventListener('click', () => {
    helpVisible = !helpVisible
    saveHelpVisible(helpVisible)
    paint()
    updateOpenIconVisual()
  })
  paint()
  return toggle
}

// --- host registry ------------------------------------------------------------

/**
 * Register a named host so callers can pass `{ host: 'name' }` without the manager
 * importing any domain helper. The value may be an element or a lazy getter.
 * @param {string} name
 * @param {HTMLElement | (() => HTMLElement | null)} elementOrGetter
 */
function registerHost (name, elementOrGetter) {
  hosts.set(name, elementOrGetter)
}

/**
 * @param {string | HTMLElement | undefined} host
 * @returns {HTMLElement | null}
 */
function resolveHost (host) {
  if (host instanceof HTMLElement) return host
  if (typeof host !== 'string') return null
  const entry = hosts.get(host)
  if (!entry) return null
  const el = typeof entry === 'function' ? entry() : entry
  return el instanceof HTMLElement ? el : null
}

// --- show / hide --------------------------------------------------------------

/**
 * Show a help topic. With `options.host` the panel attaches into that host as a
 * full-host overlay card; otherwise it appears as a floating, movable + resizable panel.
 *
 * Non-mandatory topics are silently skipped when automatic help is toggled off,
 * unless `options.force` is set (the manual ? button). Mandatory topics always show.
 * @param {string} key
 * @param {ShowOptions} [options]
 * @returns {Promise<void>}
 */
async function show (key, options = {}) {
  const myGen = ++generation
  const content = await loadHelpContent()
  if (myGen !== generation) return // superseded by another show/hide while loading
  const topic = getHelpTopic(content, key)
  if (!topic) {
    if (options.quiet) return
    console.warn(`HelpManager: no help topic for "${key}"`)
    if (key !== 'no-help-available') {
      void show('no-help-available', options)
    }
    return
  }

  if (!topic.mandatory && !helpVisible && !options.force) return

  // History: empty the stack on a fresh open; on navigation while already open,
  // push the page being left (with its scroll) so Back can return to it.
  const wasOpen = !!panelEl
  if (!wasOpen) {
    history = []
  } else if (!options._back && currentKey != null) {
    const prevBody = panelEl.querySelector('.help-panel__body')
    const scrollTop = prevBody instanceof HTMLElement ? prevBody.scrollTop : 0
    history.push({ key: currentKey, scrollTop })
  }

  hide()

  ensureOpenIcon()
  setOpenIconHidden(true)

  const hostEl = resolveHost(options.host)
  currentOnClose = options.onClose ?? null
  currentTopicIsMandatory = topic.mandatory === true

  const panel = buildCard(topic)
  panelEl = panel
  currentKey = key

  if (!currentTopicIsMandatory) {
    bindEscDismiss()
  }

  if (hostEl) {
    panel.classList.add('help-panel--host')
    hostEl.appendChild(panel)
    restoreBodyScroll(panel, options)
    return
  }

  document.body.appendChild(panel)
  applyFloatGeometry(panel)
  persistFloatGeometry(panel)
  makeDraggable(panel)
  observeFloatResize(panel)
  restoreBodyScroll(panel, options)
}

/**
 * @param {HTMLElement} panel
 * @param {ShowOptions} options
 */
function restoreBodyScroll (panel, options) {
  if (options._scrollTop == null) return
  const body = panel.querySelector('.help-panel__body')
  if (body instanceof HTMLElement) body.scrollTop = options._scrollTop
}

/** Back button: return to the previously shown topic, restoring its scroll position. */
function goBack () {
  const prev = history.pop()
  if (!prev) return
  void show(prev.key, { _back: true, _scrollTop: prev.scrollTop })
}

/** User-driven dismissal (× or Esc): close the panel and notify the caller. */
function dismiss () {
  if (currentTopicIsMandatory) return
  const cb = currentOnClose
  hide()
  cb?.()
}

/** Esc closes the panel like the × control, in both floating and host modes. */
function bindEscDismiss () {
  /** @param {KeyboardEvent} e */
  const onKey = e => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    dismiss()
  }
  document.addEventListener('keydown', onKey)
  teardown.push(() => document.removeEventListener('keydown', onKey))
}

// --- panel building ------------------------------------------------------------

/**
 * @param {import('./loadHelpContent.js').HelpTopic} topic
 * @returns {HTMLElement}
 */
function buildCard (topic) {
  const root = document.createElement('div')
  root.className = 'help-panel'

  const header = document.createElement('div')
  header.className = 'help-panel__header'

  const title = document.createElement('span')
  title.className = 'help-panel__title'
  title.textContent = topic.heading

  const actions = document.createElement('div')
  actions.className = 'help-panel__actions'

  actions.appendChild(buildAutoHelpToggle())

  if (!topic.mandatory) {
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'help-panel__close'
    close.setAttribute('aria-label', 'Close')
    close.textContent = '×'
    close.addEventListener('click', () => dismiss())
    actions.appendChild(close)
  }

  if (history.length > 0) {
    const back = document.createElement('button')
    back.type = 'button'
    back.className = 'help-panel__back'
    back.setAttribute('aria-label', 'Back')
    back.textContent = '←'
    back.addEventListener('click', () => goBack())
    header.appendChild(back)
  }

  header.appendChild(title)
  header.appendChild(actions)

  const body = document.createElement('div')
  body.className = 'help-panel__body'
  const linkCtx = { showTopic: (key) => show(key), conduit }
  body.appendChild(renderHelpText(topic.text, linkCtx))

  root.appendChild(header)
  root.appendChild(body)
  return root
}

// --- floating geometry ---------------------------------------------------------

/**
 * @param {HTMLElement} panel
 */
function applyFloatGeometry (panel) {
  const stored = loadHelpPanelGeometry()
  if (stored) {
    panel.style.width = `${stored.w}px`
    panel.style.height = `${stored.h}px`
    panel.style.left = `${clampToViewport(stored.x, stored.w, window.innerWidth)}px`
    panel.style.top = `${clampToViewport(stored.y, stored.h, window.innerHeight)}px`
    return
  }
  panel.style.width = `${DEFAULT_FLOAT_WIDTH}px`
  panel.style.height = `${DEFAULT_FLOAT_HEIGHT}px`
  panel.style.left = `${Math.round((window.innerWidth - DEFAULT_FLOAT_WIDTH) / 2)}px`
  panel.style.top = `${Math.round((window.innerHeight - DEFAULT_FLOAT_HEIGHT) / 2)}px`
}

/**
 * @param {number} pos
 * @param {number} size
 * @param {number} bound
 * @returns {number}
 */
function clampToViewport (pos, size, bound) {
  return Math.max(0, Math.min(pos, bound - size))
}

/**
 * @param {HTMLElement} panel
 */
function makeDraggable (panel) {
  const header = panel.querySelector('.help-panel__header')
  if (!(header instanceof HTMLElement)) return

  /** @param {PointerEvent} e */
  const onDown = e => {
    if (e.button !== 0) return
    if (e.target instanceof HTMLElement && e.target.closest('.help-panel__back, .help-panel__close, .help-toggle')) return
    e.preventDefault()
    header.setPointerCapture(e.pointerId)
    const rect = panel.getBoundingClientRect()
    const offsetX = e.clientX - rect.left
    const offsetY = e.clientY - rect.top

    /** @param {PointerEvent} ev */
    const onMove = ev => {
      const w = panel.offsetWidth
      const h = panel.offsetHeight
      panel.style.left = `${clampToViewport(ev.clientX - offsetX, w, window.innerWidth)}px`
      panel.style.top = `${clampToViewport(ev.clientY - offsetY, h, window.innerHeight)}px`
    }
    /** @param {PointerEvent} ev */
    const onUp = ev => {
      header.releasePointerCapture(ev.pointerId)
      header.removeEventListener('pointermove', onMove)
      header.removeEventListener('pointerup', onUp)
      header.removeEventListener('pointercancel', onUp)
      persistFloatGeometry(panel)
    }
    header.addEventListener('pointermove', onMove)
    header.addEventListener('pointerup', onUp)
    header.addEventListener('pointercancel', onUp)
  }

  header.addEventListener('pointerdown', onDown)
  teardown.push(() => header.removeEventListener('pointerdown', onDown))
}

/**
 * @param {HTMLElement} panel
 */
function observeFloatResize (panel) {
  if (typeof ResizeObserver === 'undefined') return
  let first = true
  const ro = new ResizeObserver(() => {
    if (first) { first = false; return }
    persistFloatGeometry(panel)
  })
  ro.observe(panel)
  teardown.push(() => ro.disconnect())
}

/**
 * @param {HTMLElement} panel
 */
function persistFloatGeometry (panel) {
  saveHelpPanelGeometry({
    x: panel.offsetLeft,
    y: panel.offsetTop,
    w: panel.offsetWidth,
    h: panel.offsetHeight
  })
}

/**
 * Close the floating panel or detach it from its host. Idempotent and re-entry safe so a
 * caller's `onClose` may itself call `hide()`. Never invokes `onClose` (only the × does).
 */
function hide () {
  if (hiding) return
  hiding = true
  generation++
  for (const fn of teardown) fn()
  teardown = []
  panelEl?.remove()
  panelEl = null
  currentOnClose = null
  currentTopicIsMandatory = false
  updateOpenIconVisual()
  setOpenIconHidden(false)
  positionOpenIconStandalone()
  hiding = false
}

// --- module init ---------------------------------------------------------------

if (typeof document !== 'undefined' && document.readyState !== 'loading') {
  ensureOpenIcon()
} else if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', ensureOpenIcon, { once: true })
}

export const HelpManager = { registerHost, show, hide, setConduit }
