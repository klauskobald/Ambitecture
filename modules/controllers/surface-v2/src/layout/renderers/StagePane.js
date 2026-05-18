import {
  attachStageTo,
  detachStage,
  getControllerSurface
} from '../../stage/stageCommon.js'
import { setPerformMode } from '../../stage/stageOverlayCoordinator.js'
import { PerformQuickPanelHud } from '../../perform/performQuickPanelHud.js'

export class StagePane {
  /** @type {PerformQuickPanelHud | null} */
  _quickHud = null

  /** @type {HTMLElement | null} */
  _stageSlot = null

  /** @returns {import('../../stage/controllerSurface.js').ControllerSurface | null} */
  getControllerSurface () {
    return getControllerSurface()
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.classList.add('layout-stage-pane')
    container.replaceChildren()

    const slot = document.createElement('div')
    slot.className = 'layout-stage-slot'
    container.appendChild(slot)
    this._stageSlot = slot
  }

  activate () {
    if (!this._stageSlot) return

    attachStageTo(this._stageSlot)

    const overlay = getControllerSurface()?.getOverlay()
    if (!overlay) return

    setPerformMode()

    const hudLayer = getControllerSurface()?.getPerformHudLayer()
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
    const overlay = getControllerSurface()?.getOverlay()
    overlay?.setCoactivityCallback(null)
    if (this._quickHud) {
      this._quickHud.stop()
      this._quickHud = null
    }
    detachStage()
  }
}
