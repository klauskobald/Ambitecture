import { PropertyControl } from './PropertyControl.js'
import { projectGraph } from '../../core/projectGraph.js'
import { queueIntentUpdate } from '../../core/outboundQueue.js'
import * as Modal from '../../core/Modal.js'
import { resolveMultiSelectState } from './controlHelpers.js'

export class ModalControl extends PropertyControl {
  constructor (descriptor, onCommit) {
    super(descriptor, onCommit)
    /** @type {HTMLButtonElement | null} */
    this._btn = null
  }

  /** @param {HTMLElement} area */
  _buildControlWidget (area) {
    this._btn = document.createElement('button')
    this._btn.className = 'btn prop-modal-btn'
    this._btn.textContent = '—'
    this._btn.addEventListener('click', () => this._handleClick())
    area.appendChild(this._btn)
  }

  /** @param {{ mode: 'same'|'mixed'|'absent', value: unknown, enableState: string }} state */
  _applyState (state) {
    if (!this._btn) return
    this._btn.textContent = state.mode === 'same' ? String(state.value ?? '') : '—'
  }

  async _handleClick () {
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    const fieldName = String(this._descriptor.name ?? dotKey)
    const state = resolveMultiSelectState(this._currentGuids, dotKey)
    const current = state.mode === 'same' ? String(state.value ?? '') : ''

    const result = await Modal.prompt(
      `Edit ${fieldName}`,
      [{ label: fieldName, key: 'value', placeholder: current }]
    )
    if (result === null) return

    const newValue = result['value'] ?? ''
    for (const guid of this._currentGuids) {
      const updated = projectGraph.updateIntentProperty(guid, dotKey, newValue)
      if (updated) queueIntentUpdate(updated)
    }
  }
}
