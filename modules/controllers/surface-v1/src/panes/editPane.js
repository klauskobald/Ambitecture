import { editPolicy, noopPolicy } from '../viewport/interactionPolicies.js'
import { intentGuid } from '../core/stores.js'
import { projectGraph } from '../core/projectGraph.js'
import { queueIntentUpdate } from '../core/outboundQueue.js'
import { SelectionManager } from '../viewport/selectionManager.js'
import { ColorPicker } from '../ui/colorPicker.js'
import { hslPalette } from '../ui/palettes/hslPalette.js'
import { toCSSRGB } from '../core/color.js'

export class EditPane {
  /**
   * @param {import('../viewport/overlayCanvas.js').OverlayCanvas} overlay
   */
  constructor (overlay) {
    this._overlay = overlay
    this._colorPicker = new ColorPicker([hslPalette])
    /** @type {string | null} active mode id */
    this._activeMode = null
    /** @type {Map<string, SelectionManager | null>} lazy-built per mode */
    this._managers = new Map()
    this._unsubscribe = null

    this._el = document.createElement('div')
    this._el.className = 'pane edit-pane'
    this._el.hidden = true

    this._modeBar = document.createElement('div')
    this._modeBar.className = 'mode-bar'
    this._el.appendChild(this._modeBar)

    for (const mode of this._modes()) {
      const btn = document.createElement('button')
      btn.className = 'btn btn-mode-toggle'
      btn.textContent = mode.label
      btn.dataset.modeId = mode.id
      btn.addEventListener('click', () => this._toggleMode(mode.id))
      this._modeBar.appendChild(btn)
      this._managers.set(mode.id, null)
    }
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.appendChild(this._el)
  }

  activate () {
    this._overlay.setPolicy(editPolicy)
    this._overlay.resize()
    this._el.hidden = false
  }

  deactivate () {
    this._exitCurrentMode()
    this._colorPicker.close()
    this._el.hidden = true
  }

  // ── Mode registry ─────────────────────────────────────────────────────────────

  _modes () {
    return [
      {
        id: 'performEnable',
        label: 'Perform Enable',
        buildManager: () => this._buildPerformEnableManager()
      },
      {
        id: 'color',
        label: 'Color',
        buildManager: () => this._buildColorManager()
      }
    ]
  }

  /** @param {string} modeId */
  _toggleMode (modeId) {
    if (this._activeMode === modeId) {
      this._exitCurrentMode()
    } else {
      this._exitCurrentMode()
      this._enterMode(modeId)
    }
  }

  /** @param {string} modeId */
  _enterMode (modeId) {
    const mode = this._modes().find(m => m.id === modeId)
    if (!mode) return

    let manager = this._managers.get(modeId) ?? null
    if (!manager) {
      manager = mode.buildManager()
      this._managers.set(modeId, manager)
    }

    this._activeMode = modeId
    this._overlay.setPolicy(noopPolicy)
    this._overlay.setSelectionManager(manager)

    const btn = this._modeBar.querySelector(`[data-mode-id="${modeId}"]`)
    btn?.classList.add('btn--active')
    // update button label for modes that change it
    if (modeId === 'performEnable') btn && (btn.textContent = 'Done')
  }

  _exitCurrentMode () {
    if (!this._activeMode) return

    const prev = this._activeMode
    this._activeMode = null
    this._overlay.setPolicy(editPolicy)
    this._overlay.setSelectionManager(null)
    this._colorPicker.close()

    const btn = this._modeBar.querySelector(`[data-mode-id="${prev}"]`)
    btn?.classList.remove('btn--active')
    // restore original labels
    const mode = this._modes().find(m => m.id === prev)
    if (btn && mode) btn.textContent = mode.label
  }

  // ── Manager builders ──────────────────────────────────────────────────────────

  _buildPerformEnableManager () {
    return new SelectionManager({
      getObjects: () => projectGraph.getIntents().entries(),
      getWorldPos (obj) {
        const i = /** @type {Record<string, unknown>} */ (obj)
        const pos = /** @type {number[] | undefined} */ (i.position)
        if (!pos || pos.length < 3) return null
        return { wx: pos[0], wz: pos[2] }
      },
      onTap (id, obj) {
        const guid = intentGuid(obj)
        projectGraph.setIntentConfig(guid, 'performEnabled', !projectGraph.getIntentConfig(guid).performEnabled)
      },
      drawBubble (ctx, px, py, id, obj) {
        const guid = intentGuid(obj)
        const enabled = !!(projectGraph.getIntentConfig(guid).performEnabled)
        const R = 24
        ctx.save()
        ctx.beginPath()
        ctx.arc(px, py, R, 0, Math.PI * 2)
        ctx.fillStyle = enabled ? 'rgba(85, 170, 255, 0.88)' : 'rgba(30, 30, 30, 0.82)'
        ctx.fill()
        ctx.strokeStyle = enabled ? '#5af' : '#444'
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.fillStyle = enabled ? '#fff' : '#777'
        ctx.font = 'bold 11px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(enabled ? 'ON' : 'OFF', px, py)
        ctx.restore()
      }
    })
  }

  _buildColorManager () {
    const colorPicker = this._colorPicker
    return new SelectionManager({
      getObjects: () => projectGraph.getIntents().entries(),
      getWorldPos (obj) {
        const i = /** @type {Record<string, unknown>} */ (obj)
        const pos = /** @type {number[] | undefined} */ (i.position)
        if (!pos || pos.length < 3) return null
        return { wx: pos[0], wz: pos[2] }
      },
      onTap (_id, obj) {
        const guid = intentGuid(obj)
        const i = /** @type {Record<string, unknown>} */ (obj)
        const params = /** @type {Record<string, unknown>} */ (i.params ?? {})
        const currentColor = params.color ?? { h: 0, s: 1, l: 0.25 }
        colorPicker.open(currentColor, rawColor => {
          const updated = projectGraph.updateIntentColor(guid, rawColor)
          if (updated) queueIntentUpdate(updated)
        })
      },
      drawBubble (ctx, px, py, _id, obj) {
        const i = /** @type {Record<string, unknown>} */ (obj)
        const params = /** @type {Record<string, unknown>} */ (i.params ?? {})
        const color = params.color
        const cssColor = color ? toCSSRGB(color) : 'rgb(60, 60, 60)'
        const R = 24
        ctx.save()
        ctx.beginPath()
        ctx.arc(px, py, R, 0, Math.PI * 2)
        ctx.fillStyle = cssColor
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.4)'
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.restore()
      }
    })
  }
}
