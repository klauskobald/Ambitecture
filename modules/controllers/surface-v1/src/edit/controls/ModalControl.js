import { PropertyControl } from './PropertyControl.js'
import * as Modal from '../../core/Modal.js'
import { resolveMultiSelectState } from './controlHelpers.js'

export class ModalControl extends PropertyControl {
  constructor (descriptor, onCommit, selectionSize) {
    super(descriptor, onCommit, selectionSize)
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
      [{ label: fieldName, key: 'value', value: current }]
    )
    if (result === null) return

    const newValue = result['value'] ?? ''
    for (const guid of this._currentGuids) {
      this._updateProperty(guid, dotKey, newValue)
    }
    this._saveProject()
    this.refresh(this._currentGuids)
  }
}
