import { projectGraph } from '../../core/projectGraph.js'
import { queueIntentUpdate, sendSaveProject } from '../../core/outboundQueue.js'
import { resolveMultiSelectState, resolveEnableState } from './controlHelpers.js'

export class PropertyControl {
  /**
   * @param {Record<string, unknown>} descriptor
   * @param {(dotKey: string, guids: Set<string>, value: unknown) => void} onCommit
   * @param {number} selectionSize
   */
  constructor (descriptor, onCommit, selectionSize) {
    this._descriptor = descriptor
    this._onCommit = onCommit
    this._selectionSize = selectionSize
    this._isMandatory = !!descriptor.isMandatory
    /** @type {HTMLElement | null} */
    this._controlArea = null
    /** @type {HTMLButtonElement | null} */
    this._toggleBtn = null
    /** @type {Set<string>} */
    this._currentGuids = new Set()
  }

  buildRow () {
    const row = document.createElement('div')
    row.className = 'prop-row'

    const header = document.createElement('div')
    header.className = 'prop-row__header'

    const label = document.createElement('span')
    label.className = 'prop-row__label'
    label.textContent = /** @type {string} */ (this._descriptor.name ?? this._descriptor.dotKey)

    header.appendChild(label)

    if (!this._isMandatory) {
      this._toggleBtn = document.createElement('button')
      this._toggleBtn.className = 'prop-row__toggle intent-toggle'
      this._toggleBtn.textContent = 'OFF'
      this._toggleBtn.setAttribute('aria-checked', 'false')
      this._toggleBtn.addEventListener('click', () => this._onToggleClick())
      header.appendChild(this._toggleBtn)
    }

    row.appendChild(header)

    this._controlArea = document.createElement('div')
    this._controlArea.className = 'prop-row__control'
    this._controlArea.hidden = !this._isMandatory
    this._buildControlWidget(this._controlArea)
    row.appendChild(this._controlArea)

    return row
  }

  /** @param {Set<string>} guids */
  refresh (guids) {
    this._currentGuids = guids
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)

    if (this._isMandatory) {
      if (this._controlArea) this._controlArea.hidden = false
      const multiState = resolveMultiSelectState(guids, dotKey)
      this._applyState({ ...multiState, enableState: 'on', selectionSize: guids.size })
      return
    }

    const enableState = resolveEnableState(guids, dotKey)
    const multiState = resolveMultiSelectState(guids, dotKey)

    this._applyEnableState(enableState)
    if (enableState !== 'off') {
      this._applyState({ ...multiState, enableState, selectionSize: guids.size })
    }
  }

  destroy () {}

  // ── Protected ─────────────────────────────────────────────────────────────

  /** @param {HTMLElement} _controlArea */
  _buildControlWidget (_controlArea) {
    throw new Error(`${this.constructor.name} must implement _buildControlWidget()`)
  }

  /**
   * @param {{ mode: 'same'|'mixed'|'absent', value: unknown, enableState: 'on'|'off'|'mixed', selectionSize: number }} _state
   */
  _applyState (_state) {
    throw new Error(`${this.constructor.name} must implement _applyState()`)
  }

  _saveProject () {
    sendSaveProject('intents', [...projectGraph.getIntents().values()])
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /** @param {'on' | 'off' | 'mixed'} enableState */
  _applyEnableState (enableState) {
    if (!this._toggleBtn || !this._controlArea) return
    switch (enableState) {
      case 'on':
        this._toggleBtn.textContent = 'ON'
        this._toggleBtn.setAttribute('aria-checked', 'true')
        this._toggleBtn.classList.add('intent-toggle--enabled')
        this._toggleBtn.classList.remove('prop-row__toggle--mixed')
        this._controlArea.hidden = false
        break
      case 'off':
        this._toggleBtn.textContent = 'OFF'
        this._toggleBtn.setAttribute('aria-checked', 'false')
        this._toggleBtn.classList.remove('intent-toggle--enabled', 'prop-row__toggle--mixed')
        this._controlArea.hidden = true
        break
      case 'mixed':
        this._toggleBtn.textContent = 'MIX'
        this._toggleBtn.setAttribute('aria-checked', 'mixed')
        this._toggleBtn.classList.add('prop-row__toggle--mixed')
        this._toggleBtn.classList.remove('intent-toggle--enabled')
        this._controlArea.hidden = false
        break
    }
  }

  _onToggleClick () {
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    const enableState = resolveEnableState(this._currentGuids, dotKey)
    const defaultValue = this._descriptor.defaultValue

    if (enableState === 'on') {
      for (const guid of this._currentGuids) {
        const updated = projectGraph.removeIntentProperty(guid, dotKey)
        if (updated) queueIntentUpdate(updated)
      }
    } else {
      for (const guid of this._currentGuids) {
        const updated = projectGraph.updateIntentProperty(guid, dotKey, defaultValue)
        if (updated) queueIntentUpdate(updated)
      }
    }

    this._saveProject()
    this.refresh(this._currentGuids)
  }
}
