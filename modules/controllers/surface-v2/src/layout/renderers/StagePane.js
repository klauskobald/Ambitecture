import { SimulatorViewport } from '../../viewport/simulatorViewport.js'
import { ControllerSurface } from '../../stage/controllerSurface.js'
import { setStageOverlay } from '../../stage/stageOverlayHost.js'

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
  }

  deactivate () {
    setStageOverlay(null)
  }
}
