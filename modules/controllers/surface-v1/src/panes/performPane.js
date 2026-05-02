import { performPolicy } from '../viewport/interactionPolicies.js'
import { projectGraph } from '../core/projectGraph.js'
import { sendActionTrigger } from '../core/outboundQueue.js'

/**
 * Perform pane — shows the shared simulator viewport with performPolicy active.
 * Only intents with performEnabled=true in the allowances graph can be dragged.
 */
export class PerformPane {
  /**
   * @param {import('../viewport/overlayCanvas.js').OverlayCanvas} overlay
   */
  constructor (overlay) {
    this._overlay = overlay
    this._el = document.createElement('div')
    this._el.className = 'pane perform-pane'
    this._el.hidden = true
    this._controls = document.createElement('div')
    this._controls.className = 'perform-controls'
    this._el.appendChild(this._controls)
    /** @type {Map<string, HTMLButtonElement>} */
    this._buttonByGuid = new Map()
    /** @type {(() => void) | null} */
    this._unsubscribe = null
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.appendChild(this._el)
  }

  activate () {
    this._overlay.setPolicy(performPolicy)
    this._overlay.resize()
    this._render()
    this._el.hidden = false
    this._unsubscribe = projectGraph.subscribe(() => this._render())
  }

  deactivate () {
    this._el.hidden = true
    this._unsubscribe?.()
    this._unsubscribe = null
  }

  _render () {
    const activeInputs = this._activeDisplayInputs()
    const activeGuids = new Set()

    for (const input of activeInputs) {
      const guid = String(input.guid ?? '')
      if (!guid) continue
      activeGuids.add(guid)
      const button = this._buttonForInput(guid)
      button.textContent = String(input.name ?? 'Button')
      button.dataset.actionGuid = typeof input.action === 'string' ? input.action : ''
      this._controls.appendChild(button)
    }

    for (const [guid, button] of this._buttonByGuid) {
      if (activeGuids.has(guid)) continue
      button.remove()
      this._buttonByGuid.delete(guid)
    }
  }

  /**
   * @param {string} guid
   * @returns {HTMLButtonElement}
   */
  _buttonForInput (guid) {
    const existing = this._buttonByGuid.get(guid)
    if (existing) return existing
    const button = document.createElement('button')
    button.className = 'btn perform-input perform-input--button'
    button.addEventListener('pointerdown', () => {
      const actionGuid = button.dataset.actionGuid ?? ''
      if (actionGuid) sendActionTrigger(actionGuid)
    })
    this._buttonByGuid.set(guid, button)
    return button
  }

  /** @returns {Record<string, unknown>[]} */
  _activeDisplayInputs () {
    const actions = projectGraph.getActions()
    return [...projectGraph.getInputs().values()]
      .filter(input => {
        const actionGuid = typeof input.action === 'string' ? input.action : ''
        if (!actionGuid || !actions.has(actionGuid)) return false
        const display = input.display
        if (!display || typeof display !== 'object' || Array.isArray(display)) return false
        return /** @type {Record<string, unknown>} */ (display).type === 'button'
      })
  }
}
