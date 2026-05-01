import { projectGraph } from '../../core/projectGraph.js'
import { queueIntentUpdate } from '../../core/outboundQueue.js'
import { resolveMultiSelectState, resolveEnableState, readAtDotPath } from './controlHelpers.js'

export class PropertyControl {
  /**
   * @param {Record<string, unknown>} descriptor
   * @param {(dotKey: string, guids: Set<string>, value: unknown) => void} onCommit
   */
  constructor (descriptor, onCommit) {
    this._descriptor = descriptor
    this._onCommit = onCommit
    /** @type {HTMLElement | null} */
    this._controlArea = null
    /** @type {HTMLButtonElement | null} */
    this._toggleBtn = null
    /** @type {Set<string>} */
    this._currentGuids = new Set()
  }

  /**
   * Build and return the .prop-row element.
   * @returns {HTMLElement}
   */
  buildRow () {
    const row = document.createElement('div')
    row.className = 'prop-row'

    const header = document.createElement('div')
    header.className = 'prop-row__header'

    const label = document.createElement('span')
    label.className = 'prop-row__label'
    label.textContent = /** @type {string} */ (this._descriptor.name ?? this._descriptor.dotKey)

    this._toggleBtn = document.createElement('button')
    this._toggleBtn.className = 'prop-row__toggle intent-toggle'
    this._toggleBtn.textContent = 'OFF'
    this._toggleBtn.setAttribute('aria-checked', 'false')
    this._toggleBtn.addEventListener('click', () => this._onToggleClick())

    header.appendChild(label)
    header.appendChild(this._toggleBtn)
    row.appendChild(header)

    this._controlArea = document.createElement('div')
    this._controlArea.className = 'prop-row__control'
    this._controlArea.hidden = true
    this._buildControlWidget(this._controlArea)
    row.appendChild(this._controlArea)

    return row
  }

  /**
   * Refresh the control display for the given guid set.
   * @param {Set<string>} guids
   */
  refresh (guids) {
    this._currentGuids = guids
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    const enableState = resolveEnableState(guids, dotKey)
    const multiState = resolveMultiSelectState(guids, dotKey)

    this._applyEnableState(enableState)
    if (enableState !== 'off') {
      this._applyState({ ...multiState, enableState })
    }
  }

  destroy () {}

  // ── Protected: override in subclasses ─────────────────────────────────────

  /** @param {HTMLElement} _controlArea */
  _buildControlWidget (_controlArea) {
    throw new Error(`${this.constructor.name} must implement _buildControlWidget()`)
  }

  /**
   * @param {{ mode: 'same'|'mixed'|'absent', value: unknown, enableState: 'on'|'off'|'mixed' }} _state
   */
  _applyState (_state) {
    throw new Error(`${this.constructor.name} must implement _applyState()`)
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
    const intents = projectGraph.getIntents()

    if (enableState === 'on') {
      for (const guid of this._currentGuids) {
        const updated = projectGraph.removeIntentProperty(guid, dotKey)
        if (updated) queueIntentUpdate(updated)
      }
    } else {
      const defaultValue = this._descriptor.defaultValue
      for (const guid of this._currentGuids) {
        const intent = /** @type {Record<string, unknown> | undefined} */ (intents.get(guid))
        if (!intent) continue
        const currentVal = readAtDotPath(intent, dotKey)
        if (currentVal === undefined) {
          const updated = projectGraph.updateIntentProperty(guid, dotKey, defaultValue)
          if (updated) queueIntentUpdate(updated)
        }
      }
    }
  }
}
