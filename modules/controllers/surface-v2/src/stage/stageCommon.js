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

/** @type {HTMLElement | null} */
let _attachedContainer = null

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

function cancelScheduledDispose () {
  if (_disposeTimer !== null) {
    clearTimeout(_disposeTimer)
    _disposeTimer = null
  }
}

function disposeStageBuilt () {
  if (_attachedContainer) return

  cancelScheduledDispose()

  if (_root) {
    const iframe = _root.querySelector('iframe')
    if (iframe instanceof HTMLIFrameElement) {
      iframe.src = 'about:blank'
    }
    _root.remove()
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

  _root = root
}

/**
 * @param {HTMLElement} container
 */
export function attachStageTo (container) {
  cancelScheduledDispose()
  ensureBuilt()
  if (!_root) return

  if (_root.parentElement !== container) {
    container.appendChild(_root)
  }

  _attachedContainer = container

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
  if (!_root || !_attachedContainer) return
  if (fromContainer && _attachedContainer !== fromContainer) return

  _attachedContainer = null
  _root.remove()
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
