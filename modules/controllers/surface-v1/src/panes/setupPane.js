import { noopPolicy } from '../viewport/interactionPolicies.js'

/**
 * Setup pane — scaffold for future configuration features.
 * The simulator is visible but non-interactive while this pane is active.
 */
export class SetupPane {
  /**
   * @param {import('../viewport/overlayCanvas.js').OverlayCanvas} overlay
   */
  constructor (overlay) {
    this._overlay = overlay

    this._el = document.createElement('div')
    this._el.className = 'pane setup-pane'
    this._el.hidden = true
    this._el.innerHTML = `
      <p class="setup-placeholder">Setup (coming soon)</p>
    `
    // TODO: hub connection settings
    // TODO: renderer assignment UI
    // TODO: fixture profile management
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.appendChild(this._el)
  }

  activate () {
    this._overlay.setPolicy(noopPolicy)
    this._el.hidden = false
  }

  deactivate () {
    this._el.hidden = true
  }
}
