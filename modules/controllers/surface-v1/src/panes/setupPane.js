/**
 * Setup pane — generic configuration scaffold, no simulator.
 */
export class SetupPane {
  constructor () {
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
    const simArea = document.getElementById('sim-area')
    if (simArea) simArea.hidden = true
    this._el.hidden = false
  }

  deactivate () {
    const simArea = document.getElementById('sim-area')
    if (simArea) simArea.hidden = false
    this._el.hidden = true
  }
}
