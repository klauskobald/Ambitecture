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
 */

const DEFAULT_FLOAT_WIDTH = 320
const DEFAULT_FLOAT_HEIGHT = 200
const TOGGLE_SIZE = 36

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

/** @type {boolean} */
let helpVisible = loadHelpVisible()
/** @type {boolean} */
let currentTopicIsMandatory = false
/** @type {HTMLElement | null} */
let toggleIconEl = null

/**
 * @typedef {object} HelpConduit
 * @property {(name: string, args: string) => any} callFunction
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

// --- toggle icon (persistent, always in DOM) -----------------------------------

function ensureToggleIcon () {
  if (toggleIconEl) return
  toggleIconEl = document.createElement('button')
  toggleIconEl.type = 'button'
  toggleIconEl.className = 'help-toggle-icon'
  toggleIconEl.textContent = '❓'
  toggleIconEl.setAttribute('aria-label', 'Toggle help visibility')
  toggleIconEl.addEventListener('click', onToggleClick)
  makeIconDraggable()
  updateToggleIconVisual()
  document.body.appendChild(toggleIconEl)
  positionToggleIconStandalone()
}

/** @type {boolean} */
let iconDidDrag = false

function makeIconDraggable () {
  if (!toggleIconEl) return

  /** @param {PointerEvent} e */
  const onDown = e => {
    if (e.button !== 0) return
    if (toggleIconEl.classList.contains('help-toggle-icon--in-panel')) return
    e.preventDefault()
    toggleIconEl.setPointerCapture(e.pointerId)
    const rect = toggleIconEl.getBoundingClientRect()
    const offsetX = e.clientX - rect.left
    const offsetY = e.clientY - rect.top
    iconDidDrag = false

    /** @param {PointerEvent} ev */
    const onMove = ev => {
      const dx = ev.clientX - e.clientX
      const dy = ev.clientY - e.clientY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) iconDidDrag = true
      const w = toggleIconEl.offsetWidth
      toggleIconEl.style.left = `${clampToViewport(ev.clientX - offsetX, w, window.innerWidth)}px`
      toggleIconEl.style.top = `${clampToViewport(ev.clientY - offsetY, TOGGLE_SIZE, window.innerHeight)}px`
    }
    /** @param {PointerEvent} ev */
    const onUp = ev => {
      toggleIconEl.releasePointerCapture(ev.pointerId)
      toggleIconEl.removeEventListener('pointermove', onMove)
      toggleIconEl.removeEventListener('pointerup', onUp)
      toggleIconEl.removeEventListener('pointercancel', onUp)
      if (iconDidDrag) {
        const stored = loadHelpPanelGeometry()
        const w = stored ? stored.w : DEFAULT_FLOAT_WIDTH
        const h = stored ? stored.h : DEFAULT_FLOAT_HEIGHT
        const iconRight = toggleIconEl.offsetLeft + toggleIconEl.offsetWidth
        saveHelpPanelGeometry({
          x: iconRight - w,
          y: toggleIconEl.offsetTop,
          w,
          h
        })
      }
    }
    toggleIconEl.addEventListener('pointermove', onMove)
    toggleIconEl.addEventListener('pointerup', onUp)
    toggleIconEl.addEventListener('pointercancel', onUp)
  }

  toggleIconEl.addEventListener('pointerdown', onDown)
}

function updateToggleIconVisual () {
  if (!toggleIconEl) return
  toggleIconEl.classList.toggle('help-toggle-icon--off', !helpVisible)
  if (!toggleIconEl.classList.contains('help-toggle-icon--in-panel')) {
    toggleIconEl.textContent = `❓ ${helpVisible ? 'on' : 'off'}`
  }
}

function positionToggleIconStandalone () {
  if (!toggleIconEl) return
  const stored = loadHelpPanelGeometry()
  const anchorX = stored
    ? stored.x + stored.w
    : Math.round((window.innerWidth + DEFAULT_FLOAT_WIDTH) / 2)
  const anchorY = stored
    ? stored.y
    : Math.round((window.innerHeight - DEFAULT_FLOAT_HEIGHT) / 2)
  const iconW = toggleIconEl.offsetWidth
  toggleIconEl.style.left = `${clampToViewport(anchorX - iconW, iconW, window.innerWidth)}px`
  toggleIconEl.style.top = `${clampToViewport(anchorY, TOGGLE_SIZE, window.innerHeight)}px`
  toggleIconEl.style.right = 'auto'
  toggleIconEl.style.bottom = 'auto'
}

function attachToggleToPanel (panel) {
  if (!toggleIconEl) return
  toggleIconEl.classList.add('help-toggle-icon--in-panel')
  toggleIconEl.textContent = '❓'
  const actions = panel.querySelector('.help-panel__actions')
  if (actions instanceof HTMLElement) {
    actions.appendChild(toggleIconEl)
  }
}

function detachToggleToStandalone () {
  if (!toggleIconEl) return
  toggleIconEl.classList.remove('help-toggle-icon--in-panel')
  toggleIconEl.textContent = `❓ ${helpVisible ? 'on' : 'off'}`
  document.body.appendChild(toggleIconEl)
  positionToggleIconStandalone()
}

function onToggleClick () {
  if (iconDidDrag) {
    iconDidDrag = false
    return
  }
  helpVisible = !helpVisible
  saveHelpVisible(helpVisible)
  updateToggleIconVisual()

  if (helpVisible) {
    if (!panelEl) {
      void show('index')
    }
  } else {
    if (panelEl && !currentTopicIsMandatory) {
      hide()
    }
  }
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
 * Non-mandatory topics are silently skipped when the user has toggled help off.
 * Mandatory topics always show regardless of toggle state.
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
    console.warn(`HelpManager: no help topic for "${key}"`)
    return
  }

  if (!topic.mandatory && !helpVisible) return

  hide()

  ensureToggleIcon()

  const hostEl = resolveHost(options.host)
  currentOnClose = options.onClose ?? null
  currentTopicIsMandatory = topic.mandatory === true

  const panel = buildCard(topic)
  panelEl = panel

  if (!currentTopicIsMandatory) {
    bindEscDismiss()
  }

  if (hostEl) {
    panel.classList.add('help-panel--host')
    hostEl.appendChild(panel)
    attachToggleToPanel(panel)
    return
  }

  document.body.appendChild(panel)
  applyFloatGeometry(panel)
  persistFloatGeometry(panel)
  attachToggleToPanel(panel)
  makeDraggable(panel)
  observeFloatResize(panel)
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

  if (!topic.mandatory) {
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'help-panel__close'
    close.setAttribute('aria-label', 'Close')
    close.textContent = '×'
    close.addEventListener('click', () => dismiss())
    actions.appendChild(close)
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
    if (e.target instanceof HTMLElement && e.target.closest('.help-panel__close, .help-toggle-icon')) return
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
  detachToggleToStandalone()
  hiding = false
}

// --- module init ---------------------------------------------------------------

if (typeof document !== 'undefined' && document.readyState !== 'loading') {
  ensureToggleIcon()
} else if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', ensureToggleIcon, { once: true })
}

export const HelpManager = { registerHost, show, hide, setConduit }
