import { SimulatorViewport } from '../../viewport/simulatorViewport.js'

export class Simulator2dPane {
  /** @param {string | undefined} [_arg] */
  static getButtonLabel (_arg) {
    return 'Simulator'
  }

  /**
   * @param {string} simulatorIframeUrl
   */
  constructor (simulatorIframeUrl) {
    this._simulatorIframeUrl = simulatorIframeUrl
    /** @type {SimulatorViewport | null} */
    this._viewport = null
  }

  /** @returns {SimulatorViewport | null} */
  getViewport () {
    return this._viewport
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.classList.add('layout-simulator-pane')
    container.replaceChildren()

    const stack = document.createElement('div')
    stack.className = 'layout-simulator-stack'

    const iframe = document.createElement('iframe')
    iframe.className = 'layout-simulator-frame'
    iframe.title = 'Simulator 2D (hub-driven)'

    stack.appendChild(iframe)
    container.appendChild(stack)

    this._viewport = new SimulatorViewport(iframe)
    const resolved = new URL(this._simulatorIframeUrl, window.location.href).href
    this._viewport.setSrc(resolved)
  }
}
