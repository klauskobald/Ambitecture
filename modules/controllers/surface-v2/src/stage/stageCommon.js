import { SimulatorViewport } from '../viewport/simulatorViewport.js'
import { ControllerSurface } from './controllerSurface.js'
import { setStageOverlay } from './stageOverlayHost.js'
import { refreshOverlayPolicy } from './stageOverlayCoordinator.js'

const DISPOSE_DELAY_MS = 5000

/** @type {string | null} */
let _simulatorIframeUrl = null

/** @type {import('../app/config.js').LayoutConfig | null} */
let _layoutConfig = null

/** @type {HTMLElement | null} */
let _root = null

/** @type {SimulatorViewport | null} */
let _viewport = null

/** @type {ControllerSurface | null} */
let _controllerSurface = null

/** @type {HTMLDivElement | null} */
let _persistentHost = null

/** @type {HTMLElement | null} */
let _activeSlot = null

/** @type {ResizeObserver | null} */
let _slotObserver = null

/** @type {(() => void) | null} */
let _windowResizeHandler = null

/** @type {ReturnType<typeof setTimeout> | null} */
let _disposeTimer = null

/**
 * @param {string} simulatorIframeUrl
 * @param {import('../app/config.js').LayoutConfig} layoutConfig
 */
export function initStageCommon (simulatorIframeUrl, layoutConfig) {
  _simulatorIframeUrl = simulatorIframeUrl
  _layoutConfig = layoutConfig
}

function ensurePersistentHost () {
  if (_persistentHost) return _persistentHost
  const host = document.createElement('div')
  Object.assign(host.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '0',
    height: '0',
    pointerEvents: 'auto',
    zIndex: '5',
    display: 'none'
  })
  document.body.appendChild(host)
  _persistentHost = host
  return host
}

function cancelScheduledDispose () {
  if (_disposeTimer !== null) {
    clearTimeout(_disposeTimer)
    _disposeTimer = null
  }
}

function disposeStageBuilt () {
  if (_activeSlot) return

  cancelScheduledDispose()

  if (_root) {
    const iframe = _root.querySelector('iframe')
    if (iframe instanceof HTMLIFrameElement) {
      iframe.src = 'about:blank'
    }
    _root.remove()
  }

  if (_persistentHost) {
    _persistentHost.remove()
    _persistentHost = null
  }

  _root = null
  _viewport = null
  _controllerSurface = null
  setStageOverlay(null)
}

function scheduleDispose () {
  cancelScheduledDispose()
  _disposeTimer = setTimeout(() => {
    _disposeTimer = null
    disposeStageBuilt()
  }, DISPOSE_DELAY_MS)
}

function ensureBuilt () {
  if (_root) return
  if (!_simulatorIframeUrl || !_layoutConfig) {
    throw new Error('initStageCommon must be called before attachStageTo')
  }

  const host = ensurePersistentHost()

  const root = document.createElement('div')
  root.className = 'layout-stage-common-root'

  const stack = document.createElement('div')
  stack.className = 'layout-stage-stack'

  const iframe = document.createElement('iframe')
  iframe.className = 'layout-stage-frame'
  iframe.title = 'Simulator 2D (hub-driven)'

  stack.appendChild(iframe)
  root.appendChild(stack)

  _viewport = new SimulatorViewport(iframe)
  const resolved = new URL(_simulatorIframeUrl, window.location.href).href
  _viewport.setSrc(resolved)

  _controllerSurface = new ControllerSurface(_viewport, _layoutConfig)
  _controllerSurface.mount(stack)

  host.appendChild(root)
  _root = root
}

function syncHostRect () {
  if (!_activeSlot || !_persistentHost) return
  const r = _activeSlot.getBoundingClientRect()
  const s = _persistentHost.style
  s.left = `${r.left}px`
  s.top = `${r.top}px`
  s.width = `${r.width}px`
  s.height = `${r.height}px`
  _controllerSurface?.getOverlay()?.resize()
}

/** @param {HTMLElement} slot */
function subscribeToActiveSlot (slot) {
  _slotObserver = new ResizeObserver(() => syncHostRect())
  _slotObserver.observe(slot)
  _windowResizeHandler = () => syncHostRect()
  window.addEventListener('resize', _windowResizeHandler)
  syncHostRect()
  requestAnimationFrame(syncHostRect)
}

function unsubscribeFromActiveSlot () {
  if (_slotObserver) {
    _slotObserver.disconnect()
    _slotObserver = null
  }
  if (_windowResizeHandler) {
    window.removeEventListener('resize', _windowResizeHandler)
    _windowResizeHandler = null
  }
}

/**
 * @param {HTMLElement} container
 */
export function attachStageTo (container) {
  cancelScheduledDispose()
  ensureBuilt()
  if (!_root || !_persistentHost) return

  if (_activeSlot && _activeSlot !== container) {
    unsubscribeFromActiveSlot()
  }

  _activeSlot = container
  _persistentHost.style.display = ''

  subscribeToActiveSlot(container)

  const overlay = _controllerSurface?.getOverlay()
  if (overlay) {
    setStageOverlay(overlay)
    refreshOverlayPolicy()
    overlay.resize()
  }
}

/**
 * @param {HTMLElement} [fromContainer] no-op if sim already moved to another slot
 */
export function detachStage (fromContainer) {
  if (!_activeSlot) return
  if (fromContainer && _activeSlot !== fromContainer) return

  unsubscribeFromActiveSlot()
  _activeSlot = null
  if (_persistentHost) _persistentHost.style.display = 'none'
  scheduleDispose()
}

/** @returns {ControllerSurface | null} */
export function getControllerSurface () {
  return _controllerSurface
}

/** @returns {SimulatorViewport | null} */
export function getViewport () {
  return _viewport
}

/** @returns {import('../viewport/overlayCanvas.js').OverlayCanvas | null} */
export function getOverlay () {
  return _controllerSurface?.getOverlay() ?? null
}
