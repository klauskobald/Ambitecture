import { PropertyControl } from './PropertyControl.js'
import { projectGraph } from '../../core/projectGraph.js'
import { queueIntentUpdate } from '../../core/outboundQueue.js'

export class PillControl extends PropertyControl {
  constructor (descriptor, onCommit, selectionSize) {
    super(descriptor, onCommit, selectionSize)
    /** @type {HTMLButtonElement[]} */
    this._pills = []
  }

  /** @param {HTMLElement} area */
  _buildControlWidget (area) {
    const group = document.createElement('div')
    group.className = 'prop-pills'

    const options = /** @type {string[]} */ (this._descriptor.options ?? [])
    for (const option of options) {
      const btn = document.createElement('button')
      btn.className = 'prop-pill intent-toggle'
      btn.textContent = option
      btn.dataset.value = option
      btn.addEventListener('click', () => this._handlePillClick(option))
      group.appendChild(btn)
      this._pills.push(btn)
    }

    area.appendChild(group)
  }

  /** @param {{ mode: 'same'|'mixed'|'absent', value: unknown, enableState: string }} state */
  _applyState (state) {
    for (const pill of this._pills) {
      const isActive = state.mode === 'same' && pill.dataset.value === String(state.value ?? '')
      pill.classList.toggle('prop-pill--active', isActive)
      pill.classList.toggle('intent-toggle--enabled', isActive)
    }
  }

  /** @param {string} option */
  _handlePillClick (option) {
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    for (const guid of this._currentGuids) {
      const updated = projectGraph.updateIntentProperty(guid, dotKey, option)
      if (updated) queueIntentUpdate(updated)
    }
    this._saveProject()
    this.refresh(this._currentGuids)
  }
}
