import { PerformButton } from './PerformButton.js'
import { projectGraph, inputActionGuidList } from '../projectGraph.js'
import { isAnimationPlaying } from '../animationPlayRegistry.js'

export class PerformButtonToggle extends PerformButton {
  render () {
    const { labelEl, badgeEl, keyHintEl } = this._ensureChrome()

    this._updateLabel(labelEl)
    this._updateKeyHint(keyHintEl)
    this._updateActionDatasets()
    this._updateInputGuidDataset()
    this._updateBehaviorDataset()
    this._updateUnassignedBadge(badgeEl)
    this._updateHighlightClass()
    this._updateAriaAttrs()
  }

  /**
   * Toggle shows actual state of its assigned entity (no latched browser state).
   * @returns {boolean}
   */
  _isHighlighted () {
    if (!this._inputGuid) return false
    const input = projectGraph.getInputs().get(this._inputGuid)
    if (!input) return false

    const ags = inputActionGuidList(
      /** @type {Record<string, unknown>} */ (input)
    )
    for (const actionGuid of ags) {
      const action = projectGraph.getActions().get(actionGuid)
      if (!action) continue

      const ex = action.execute
      if (!ex || typeof ex !== 'object' || Array.isArray(ex)) continue

      switch (ex.type) {
        case 'scene': {
          const activeSceneName = projectGraph.getActiveSceneName()
          const activeSceneGuid = activeSceneName
            ? projectGraph.getSceneGuid(activeSceneName)
            : null
          if (ex.guid === activeSceneGuid) return true
          break
        }
        case 'animation': {
          const animationGuid = typeof ex.guid === 'string' ? ex.guid : ''
          if (animationGuid && isAnimationPlaying(animationGuid)) return true
          break
        }
      }
    }
    return false
  }

  /**
   * Override base class to use ARIA attributes for toggle role (not switch).
   */
  _updateAriaAttrs () {
    const newBehavior = typeof this._inputData.type === 'string' ? this._inputData.type : 'button'
    const isToggle = newBehavior === 'toggle'
    if (isToggle) {
      const highlighted = this._isHighlighted()
      this._buttonElement.setAttribute('role', 'switch')
      this._buttonElement.setAttribute('aria-pressed', highlighted ? 'true' : 'false')
    } else {
      this._buttonElement.removeAttribute('role')
      this._buttonElement.removeAttribute('aria-pressed')
    }
  }
}
