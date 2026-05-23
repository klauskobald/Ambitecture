import { createPerformSnapshotPanel } from '../../perform/performSnapshotPanel.js'

export class SnapshotPane {
  constructor () {
    /** @type {HTMLDivElement | null} */
    this._panel = null
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.classList.add('layout-perform-pane')
    const { panel } = createPerformSnapshotPanel()
    this._panel = panel
    container.appendChild(panel)
  }

  activate () {}

  deactivate () {}
}
