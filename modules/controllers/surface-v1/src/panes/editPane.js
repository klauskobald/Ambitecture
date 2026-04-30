import { editPolicy, noopPolicy } from '../viewport/interactionPolicies.js'
import { getIntents, intentGuid, getAllowances, setAllowance } from '../core/stores.js'
import { SelectionManager } from '../viewport/selectionManager.js'

export class EditPane {
  /**
   * @param {import('../viewport/overlayCanvas.js').OverlayCanvas} overlay
   */
  constructor (overlay) {
    this._overlay = overlay
    this._enableModeActive = false

    this._el = document.createElement('div')
    this._el.className = 'pane edit-pane'
    this._el.hidden = true

    this._toggleBtn = document.createElement('button')
    this._toggleBtn.className = 'btn btn-mode-toggle'
    this._toggleBtn.textContent = 'Perform Enable'
    this._toggleBtn.addEventListener('click', () => this._toggleEnableMode())
    this._el.appendChild(this._toggleBtn)
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
    this._exitEnableMode()
    this._el.hidden = true
  }

  _toggleEnableMode () {
    if (this._enableModeActive) {
      this._exitEnableMode()
    } else {
      this._enterEnableMode()
    }
  }

  _enterEnableMode () {
    this._enableModeActive = true
    this._overlay.setPolicy(noopPolicy)
    this._overlay.setSelectionManager(this._buildSelectionManager())
    this._toggleBtn.classList.add('btn--active')
    this._toggleBtn.textContent = 'Done'
  }

  _exitEnableMode () {
    if (!this._enableModeActive) return
    this._enableModeActive = false
    this._overlay.setPolicy(editPolicy)
    this._overlay.setSelectionManager(null)
    this._toggleBtn.classList.remove('btn--active')
    this._toggleBtn.textContent = 'Perform Enable'
  }

  _buildSelectionManager () {
    return new SelectionManager({
      getObjects: () => getIntents().entries(),

      getWorldPos (obj) {
        const i = /** @type {Record<string, unknown>} */ (obj)
        const pos = /** @type {number[] | undefined} */ (i.position)
        if (!pos || pos.length < 3) return null
        return { wx: pos[0], wz: pos[2] }
      },

      onTap (id, obj) {
        const guid = intentGuid(obj)
        const current = !!(getAllowances()[guid]?.performEnabled)
        setAllowance(guid, 'performEnabled', !current)
      },

      drawBubble (ctx, px, py, id, obj) {
        const guid = intentGuid(obj)
        const enabled = !!(getAllowances()[guid]?.performEnabled)
        const BUBBLE_R = 24

        ctx.save()

        // bubble fill
        ctx.beginPath()
        ctx.arc(px, py, BUBBLE_R, 0, Math.PI * 2)
        ctx.fillStyle = enabled ? 'rgba(85, 170, 255, 0.88)' : 'rgba(30, 30, 30, 0.82)'
        ctx.fill()

        // bubble stroke
        ctx.strokeStyle = enabled ? '#5af' : '#444'
        ctx.lineWidth = 2
        ctx.stroke()

        // ON / OFF label
        ctx.fillStyle = enabled ? '#fff' : '#777'
        ctx.font = 'bold 11px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(enabled ? 'ON' : 'OFF', px, py)

        ctx.restore()
      }
    })
  }
}
