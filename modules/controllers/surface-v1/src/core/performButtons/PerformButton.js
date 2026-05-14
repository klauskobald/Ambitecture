import { normalizeInputKeyChar } from '../performButtonInputs.js'
import { getPerformToggleOn, clearPerformToggleState } from '../performToggleLocalState.js'
import { projectGraph, inputActionGuidList } from '../projectGraph.js'

export class PerformButton {
  /**
   * @param {string} inputGuid
   * @param {Record<string, unknown>} inputData
   * @param {HTMLButtonElement} buttonElement
   */
  constructor (inputGuid, inputData, buttonElement) {
    this._inputGuid = inputGuid
    this._inputData = inputData
    this._buttonElement = buttonElement
  }

  /**
   * Abstract method — must be implemented by derived classes.
   * Updates the button DOM and all styling based on current state.
   */
  render (_) {
    throw new Error(`${this.constructor.name} must implement render()`)
  }

  /**
   * Override in derived classes to provide type-specific highlighting logic.
   * @returns {boolean}
   */
  _isHighlighted () {
    return false
  }

  /**
   * Ensure button has label, keyhint, and unassigned badge elements.
   * @returns {{ labelEl: HTMLSpanElement, badgeEl: HTMLSpanElement, keyHintEl: HTMLSpanElement }}
   */
  _ensureChrome () {
    let labelEl = this._buttonElement.querySelector('.perform-input__label')
    let badgeEl = this._buttonElement.querySelector('.perform-input__badge--unassigned')
    let keyHintEl = this._buttonElement.querySelector('.perform-input__keyhint')
    if (!labelEl || !badgeEl || !keyHintEl) {
      this._buttonElement.replaceChildren()
      labelEl = document.createElement('span')
      labelEl.className = 'perform-input__label'
      keyHintEl = document.createElement('span')
      keyHintEl.className = 'perform-input__keyhint'
      keyHintEl.hidden = true
      badgeEl = document.createElement('span')
      badgeEl.className =
        'perform-input__badge perform-input__badge--unassigned'
      badgeEl.textContent = 'unassigned'
      badgeEl.hidden = true
      this._buttonElement.appendChild(labelEl)
      this._buttonElement.appendChild(keyHintEl)
      this._buttonElement.appendChild(badgeEl)
    }
    return {
      labelEl: /** @type {HTMLSpanElement} */ (labelEl),
      badgeEl: /** @type {HTMLSpanElement} */ (badgeEl),
      keyHintEl: /** @type {HTMLSpanElement} */ (keyHintEl)
    }
  }

  /**
   * Update label text if it changed.
   * @param {HTMLSpanElement} labelEl
   */
  _updateLabel (labelEl) {
    const newText = String(this._inputData.name ?? 'Button')
    if (labelEl.textContent !== newText) labelEl.textContent = newText
  }

  /**
   * Update keyhint visibility and text.
   * @param {HTMLSpanElement} keyHintEl
   */
  _updateKeyHint (keyHintEl) {
    const keyLabel = normalizeInputKeyChar(this._inputData.keyChar)
    if (keyHintEl) {
      keyHintEl.textContent = keyLabel
      keyHintEl.hidden = !keyLabel
    }
    this._buttonElement.classList.toggle('perform-input--has-keyhint', Boolean(keyLabel))
  }

  /**
   * Update action dataset attributes.
   */
  _updateActionDatasets () {
    const ags = inputActionGuidList(
      /** @type {Record<string, unknown>} */ (this._inputData)
    )
    const newAction = ags[0] ?? ''
    if (this._buttonElement.dataset.actionGuid !== newAction)
      this._buttonElement.dataset.actionGuid = newAction
    if (this._buttonElement.dataset.actionGuids !== ags.join(','))
      this._buttonElement.dataset.actionGuids = ags.join(',')
  }

  /**
   * Update input guid dataset.
   */
  _updateInputGuidDataset () {
    if (this._buttonElement.dataset.inputGuid !== this._inputGuid)
      this._buttonElement.dataset.inputGuid = this._inputGuid
  }

  /**
   * Update behavior dataset and handle toggle state cleanup.
   */
  _updateBehaviorDataset () {
    const prevBehavior = this._buttonElement.dataset.behavior ?? ''
    const newBehavior = typeof this._inputData.type === 'string' ? this._inputData.type : 'button'
    if (prevBehavior === 'toggle' && newBehavior !== 'toggle') {
      clearPerformToggleState(this._inputGuid)
    }
    if (this._buttonElement.dataset.behavior !== newBehavior)
      this._buttonElement.dataset.behavior = newBehavior
    return newBehavior
  }

  /**
   * Update unassigned badge visibility.
   * @param {HTMLSpanElement} badgeEl
   */
  _updateUnassignedBadge (badgeEl) {
    const ags = inputActionGuidList(
      /** @type {Record<string, unknown>} */ (this._inputData)
    )
    const actions = projectGraph.getActions()
    const unassigned = ags.length === 0 || !ags.every(ag => actions.has(ag))
    this._buttonElement.classList.toggle('perform-input--unassigned', unassigned)
    if (badgeEl) badgeEl.hidden = !unassigned
  }

  /**
   * Update active/highlighted state based on highlighting + toggle state.
   */
  _updateHighlightClass () {
    const highlighted = this._isHighlighted()
    const newBehavior = typeof this._inputData.type === 'string' ? this._inputData.type : 'button'
    const toggleLatched = newBehavior === 'toggle' && getPerformToggleOn(this._inputGuid)
    this._buttonElement.classList.toggle('btn--active', highlighted || toggleLatched)
  }

  /**
   * Update ARIA attributes for toggle behavior.
   */
  _updateAriaAttrs () {
    const newBehavior = typeof this._inputData.type === 'string' ? this._inputData.type : 'button'
    const isToggle = newBehavior === 'toggle'
    if (isToggle) {
      const toggleLatched = getPerformToggleOn(this._inputGuid)
      this._buttonElement.setAttribute('role', 'switch')
      this._buttonElement.setAttribute('aria-pressed', toggleLatched ? 'true' : 'false')
    } else {
      this._buttonElement.removeAttribute('role')
      this._buttonElement.removeAttribute('aria-pressed')
    }
  }

  /**
   * Get action GUIDs from input.
   * @returns {string[]}
   */
  _getActionGuids () {
    return inputActionGuidList(
      /** @type {Record<string, unknown>} */ (this._inputData)
    )
  }

  /**
   * Get action target type (scene, animation, intent).
   * @returns {string | null}
   */
  _getActionTargetType () {
    const ags = this._getActionGuids()
    if (ags.length === 0) return null
    const action = projectGraph.getActions().get(ags[0])
    if (!action) return null
    const ex = action.execute
    if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return null
    return typeof ex.type === 'string' ? ex.type : null
  }
}
