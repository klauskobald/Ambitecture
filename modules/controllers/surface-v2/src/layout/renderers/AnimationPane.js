import { createPerformAnimatePanel } from '../../perform/performAnimatePanel.js'
import {
  enterPerformIntentFilterPane,
  leavePerformIntentFilterPane
} from '../../perform/performIntentFilterChip.js'
import { togglePerformIntentFilter } from '../../core/performIntentFilter.js'
import { getControllerSurface } from '../../stage/stageCommon.js'

export class AnimationPane {
  constructor () {
    /** @type {HTMLElement | null} */
    this._mountEl = null
    /** @type {HTMLDivElement | null} */
    this._panel = null
    /** @type {(() => void) | null} */
    this._overlayTapUnsub = null
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.classList.add('layout-perform-pane')
    this._mountEl = container
    const { panel } = createPerformAnimatePanel()
    this._panel = panel
    container.appendChild(panel)
  }

  activate () {
    if (this._mountEl) enterPerformIntentFilterPane(this._mountEl)
    const overlay = getControllerSurface()?.getOverlay()
    if (!overlay) return
    overlay.setSingleTapIntentCallback(guid => {
      togglePerformIntentFilter(guid)
    })
  }

  deactivate () {
    leavePerformIntentFilterPane()
    const overlay = getControllerSurface()?.getOverlay()
    overlay?.setSingleTapIntentCallback(null)
  }
}
