import { PerformButton } from './PerformButton.js'
import { isMomentaryPressed } from '../performMomentaryRegistry.js'
import { projectGraph, inputActionGuidList } from '../projectGraph.js'
import { isAnimationPlaying } from '../animationPlayRegistry.js'

export class PerformButtonMomentarySwitch extends PerformButton {
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
   * True when momentary switch is pressed OR its assigned entity is active.
   * @returns {boolean}
   */
  _isHighlighted () {
    if (!this._inputGuid) return false
    
    const isPressed = isMomentaryPressed(this._inputGuid)
    if (isPressed) return true
    
    return this._isEntityHighlighted()
  }

  /**
   * Check if the button's assigned entity is highlighted (scene active, animation running, etc).
   * @returns {boolean}
   */
  _isEntityHighlighted () {
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
}
