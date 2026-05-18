import { createPerformPulsePanel } from '../../perform/performPulsePanel.js'

export class PulsePane {
  constructor () {
    /** @type {HTMLDivElement | null} */
    this._panel = null
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.classList.add('layout-perform-pane')
    const { panel } = createPerformPulsePanel()
    this._panel = panel
    container.appendChild(panel)
  }

  activate () {}

  deactivate () {}
}
