import { editPolicy } from '../viewport/interactionPolicies.js'
import { getIntents, intentGuid, intentName, getAllowances, setAllowance, subscribeToStores } from '../core/stores.js'

/**
 * Edit pane — full drag access (intents + fixtures) plus per-intent Perform enable toggles.
 */
export class EditPane {
  /**
   * @param {import('../viewport/overlayCanvas.js').OverlayCanvas} overlay
   */
  constructor (overlay) {
    this._overlay = overlay
    this._unsubscribe = null

    this._el = document.createElement('div')
    this._el.className = 'pane edit-pane'
    this._el.hidden = true

    this._intentList = document.createElement('div')
    this._intentList.className = 'intent-list'
    this._el.appendChild(this._intentList)
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.appendChild(this._el)
  }

  activate () {
    this._overlay.setPolicy(editPolicy)
    this._overlay.resize()
    this._el.hidden = false
    this._unsubscribe = subscribeToStores(() => this._render())
    this._render()
  }

  deactivate () {
    this._unsubscribe?.()
    this._unsubscribe = null
    this._el.hidden = true
  }

  _render () {
    const intents = getIntents()
    const allowances = getAllowances()
    const list = this._intentList
    list.innerHTML = ''

    if (intents.size === 0) {
      const empty = document.createElement('p')
      empty.className = 'intent-list-empty'
      empty.textContent = 'No intents received yet.'
      list.appendChild(empty)
      return
    }

    for (const intent of intents.values()) {
      const guid = intentGuid(intent)
      const name = intentName(intent) || guid
      const performEnabled = !!(allowances[guid]?.performEnabled)

      const row = document.createElement('label')
      row.className = 'intent-row'

      const toggle = document.createElement('input')
      toggle.type = 'checkbox'
      toggle.className = 'intent-perform-toggle'
      toggle.checked = performEnabled
      toggle.addEventListener('change', () => {
        setAllowance(guid, 'performEnabled', toggle.checked)
      })

      const label = document.createElement('span')
      label.className = 'intent-name'
      label.textContent = name

      row.appendChild(toggle)
      row.appendChild(label)
      list.appendChild(row)
    }
  }
}
