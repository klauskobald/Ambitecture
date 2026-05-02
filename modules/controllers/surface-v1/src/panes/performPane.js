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
    this._el.innerHTML = ''
    const activeInputs = this._activeDisplayInputs()
    if (activeInputs.length === 0) return

    const controls = document.createElement('div')
    controls.className = 'perform-controls'
    for (const input of activeInputs) {
      const button = document.createElement('button')
      button.className = 'btn perform-input perform-input--button'
      button.textContent = String(input.name ?? 'Button')
      button.addEventListener('click', () => {
        if (typeof input.action === 'string') sendActionTrigger(input.action)
      })
      controls.appendChild(button)
    }
    this._el.appendChild(controls)
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
