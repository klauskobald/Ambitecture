import { OverlayCanvas } from '../viewport/overlayCanvas.js'
import { projectGraph } from '../core/projectGraph.js'
import { sendSceneActivate } from '../core/outboundQueue.js'

/**
 * Touch overlay, perform HUD host, and runtime reset chrome above the simulator iframe.
 */
export class ControllerSurface {
  /**
   * @param {import('../viewport/simulatorViewport.js').SimulatorViewport} viewport
   * @param {import('../app/config.js').LayoutConfig} layoutConfig
   */
  constructor (viewport, layoutConfig) {
    this._viewport = viewport
    this._layoutConfig = layoutConfig
    /** @type {OverlayCanvas | null} */
    this._overlay = null
    /** @type {HTMLElement | null} */
    this._performHudLayer = null
    /** @type {HTMLElement | null} */
    this._resetWrap = null
  }

  /** @returns {OverlayCanvas | null} */
  getOverlay () {
    return this._overlay
  }

  /** @returns {HTMLElement | null} */
  getPerformHudLayer () {
    return this._performHudLayer
  }

  /**
   * Appends overlay layers to `stackEl` (iframe should already be a child).
   * @param {HTMLElement} stackEl
   */
  mount (stackEl) {
    const canvas = document.createElement('canvas')
    canvas.className = 'layout-stage-overlay'
    canvas.setAttribute('aria-hidden', 'true')

    const hudLayer = document.createElement('div')
    hudLayer.className = 'layout-stage-hud-layer'
    hudLayer.setAttribute('aria-hidden', 'true')

    const resetWrap = document.createElement('div')
    resetWrap.className = 'layout-stage-reset-wrap'
    resetWrap.hidden = true

    const resetBtn = document.createElement('button')
    resetBtn.type = 'button'
    resetBtn.className = 'layout-stage-reset-btn'
    resetBtn.textContent = 'Reset scene'
    resetWrap.appendChild(resetBtn)

    stackEl.appendChild(canvas)
    stackEl.appendChild(hudLayer)
    stackEl.appendChild(resetWrap)

    this._performHudLayer = hudLayer
    this._resetWrap = resetWrap
    this._overlay = new OverlayCanvas(
      canvas,
      stackEl,
      this._viewport,
      this._layoutConfig
    )

    const syncRuntimeOverlayResetUi = () => {
      if (!this._resetWrap) return
      const guids = projectGraph.getRuntimeOverlayGuidsInScene()
      const active = projectGraph.getActiveSceneName()
      this._resetWrap.hidden =
        !(guids.length > 0 && typeof active === 'string' && active.length > 0)
    }

    resetBtn.addEventListener('click', () => {
      const name = projectGraph.getActiveSceneName()
      if (typeof name !== 'string' || name.length === 0) return
      const guid = projectGraph.getSceneGuid(name)
      if (!guid) return
      sendSceneActivate(guid, { runtimeMergeClear: 'scene' })
    })
    projectGraph.subscribe(['runtimeOverlayHints', 'scenes'], syncRuntimeOverlayResetUi)
    syncRuntimeOverlayResetUi()
  }
}
