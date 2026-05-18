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

  /** @type {HTMLButtonElement | null} */
  _hudToggleBtn = null

  /** @type {boolean} */
  _hudsVisible = true

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

    const hudToggle = document.createElement('button')
    hudToggle.type = 'button'
    hudToggle.className = 'layout-stage-hud-toggle intent-toggle'
    hudToggle.textContent = '\u2742'
    hudToggle.setAttribute('aria-label', 'Perform HUDs')
    hudToggle.title = 'Hide perform HUD knobs'
    hudToggle.addEventListener('click', () => {
      this._hudsVisible = !this._hudsVisible
      this._applyHudLayerVisibility()
    })
    this._hudToggleBtn = hudToggle
    this._syncHudToggleButton()
  }

  _mountHudToggleOnStack () {
    const stack = getControllerSurface()?.getStack()
    const btn = this._hudToggleBtn
    if (!stack || !btn || btn.parentElement === stack) return
    stack.appendChild(btn)
  }

  _unmountHudToggleFromStack () {
    this._hudToggleBtn?.remove()
  }

  _syncHudToggleButton () {
    const btn = this._hudToggleBtn
    if (!btn) return
    btn.setAttribute('aria-pressed', String(this._hudsVisible))
    btn.classList.toggle('intent-toggle--enabled', this._hudsVisible)
    btn.title = this._hudsVisible
      ? 'Hide perform HUD knobs'
      : 'Show perform HUD knobs'
  }

  _applyHudLayerVisibility () {
    const layer = getControllerSurface()?.getPerformHudLayer()
    if (layer) layer.hidden = !this._hudsVisible
    this._syncHudToggleButton()
    if (this._hudsVisible) {
      this._quickHud?.markLayoutActivity()
      getControllerSurface()?.getOverlay()?.markRenderActivity()
    }
  }

  activate () {
    if (!this._stageSlot) return

    attachStageTo(this._stageSlot)

    const overlay = getControllerSurface()?.getOverlay()
    if (!overlay) return

    setPerformMode()
    this._mountHudToggleOnStack()

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
    this._applyHudLayerVisibility()
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
    this._unmountHudToggleFromStack()
    detachStage()
  }
}
