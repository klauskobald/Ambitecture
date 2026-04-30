import { performPolicy } from '../viewport/interactionPolicies.js'

/**
 * Perform pane — shows the shared simulator viewport with performPolicy active.
 * Only intents with performEnabled=true in the allowances graph can be dragged.
 */
export class PerformPane {
  /**
   * @param {import('../viewport/overlayCanvas.js').OverlayCanvas} overlay
   */
  constructor (overlay) {
    this._overlay = overlay
    this._el = document.createElement('div')
    this._el.className = 'pane perform-pane'
    this._el.hidden = true
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.appendChild(this._el)
  }

  activate () {
    this._overlay.setPolicy(performPolicy)
    this._overlay.resize()
    this._el.hidden = false
  }

  deactivate () {
    this._el.hidden = true
  }
}
