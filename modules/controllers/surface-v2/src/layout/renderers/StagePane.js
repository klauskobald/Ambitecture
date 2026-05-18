import { SimulatorViewport } from '../../viewport/simulatorViewport.js'
import { ControllerSurface } from '../../stage/controllerSurface.js'
import { setStageOverlay } from '../../stage/stageOverlayHost.js'
import {
  setPerformMode,
  refreshOverlayPolicy
} from '../../stage/stageOverlayCoordinator.js'
import { PerformQuickPanelHud } from '../../perform/performQuickPanelHud.js'

export class StagePane {
  /**
   * @param {string} simulatorIframeUrl
   * @param {import('../../app/config.js').LayoutConfig} layoutConfig
   */
  constructor (simulatorIframeUrl, layoutConfig) {
    this._simulatorIframeUrl = simulatorIframeUrl
    this._layoutConfig = layoutConfig
    /** @type {SimulatorViewport | null} */
    this._viewport = null
    /** @type {ControllerSurface | null} */
    this._controllerSurface = null
    /** @type {PerformQuickPanelHud | null} */
    this._quickHud = null
  }

  /** @returns {ControllerSurface | null} */
  getControllerSurface () {
    return this._controllerSurface
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.classList.add('layout-stage-pane')
    container.replaceChildren()

    const stack = document.createElement('div')
    stack.className = 'layout-stage-stack'

    const iframe = document.createElement('iframe')
    iframe.className = 'layout-stage-frame'
    iframe.title = 'Simulator 2D (hub-driven)'

    stack.appendChild(iframe)
    container.appendChild(stack)

    this._viewport = new SimulatorViewport(iframe)
    const resolved = new URL(this._simulatorIframeUrl, window.location.href).href
    this._viewport.setSrc(resolved)

    this._controllerSurface = new ControllerSurface(this._viewport, this._layoutConfig)
    this._controllerSurface.mount(stack)

    const overlay = this._controllerSurface.getOverlay()
    if (overlay) {
      setStageOverlay(overlay)
      refreshOverlayPolicy()
    }
  }

  activate () {
    const overlay = this._controllerSurface?.getOverlay()
    if (!overlay) return

    setPerformMode()

    const hudLayer = this._controllerSurface?.getPerformHudLayer()
    if (hudLayer) {
      try {
        this._quickHud = new PerformQuickPanelHud(overlay, hudLayer)
        overlay.setCoactivityCallback(() => {
          this._quickHud?.markLayoutActivity()
        })
        this._quickHud.start()
      } catch {
        this._quickHud = null
      }
    }
    overlay.resize()
    overlay.markRenderActivity()
  }

  deactivate () {
    const overlay = this._controllerSurface?.getOverlay()
    overlay?.setCoactivityCallback(null)
    if (this._quickHud) {
      this._quickHud.stop()
      this._quickHud = null
    }
  }
}
