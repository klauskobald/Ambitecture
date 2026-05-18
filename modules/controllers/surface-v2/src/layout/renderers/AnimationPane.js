import { createPerformAnimatePanel } from '../../perform/performAnimatePanel.js'
import { togglePerformIntentFilter } from '../../core/performIntentFilter.js'
import { getControllerSurface } from '../../stage/stageCommon.js'

export class AnimationPane {
  /** @param {string | undefined} [_arg] */
  static getButtonLabel (_arg) {
    return 'Animate'
  }

  constructor () {
    /** @type {HTMLDivElement | null} */
    this._panel = null
    /** @type {(() => void) | null} */
    this._overlayTapUnsub = null
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.classList.add('layout-perform-pane')
    const { panel } = createPerformAnimatePanel()
    this._panel = panel
    container.appendChild(panel)
  }

  activate () {
    const overlay = getControllerSurface()?.getOverlay()
    if (!overlay) return
    overlay.setSingleTapIntentCallback(guid => {
      togglePerformIntentFilter(guid)
    })
  }

  deactivate () {
    const overlay = getControllerSurface()?.getOverlay()
    overlay?.setSingleTapIntentCallback(null)
  }
}
