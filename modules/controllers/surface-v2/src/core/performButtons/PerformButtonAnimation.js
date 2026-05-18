import { PerformButton } from './PerformButton.js'
import { isAnimationPlaying } from '../animationPlayRegistry.js'
import { projectGraph, inputActionGuidList } from '../projectGraph.js'

export class PerformButtonAnimation extends PerformButton {
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
   * True when this input's action targets a running animation.
   * @returns {boolean}
   */
  _isHighlighted () {
    if (!this._inputGuid) return false
    const ags = inputActionGuidList(
      /** @type {Record<string, unknown>} */ (this._inputData)
    )
    for (const actionGuid of ags) {
      const action = projectGraph.getActions().get(actionGuid)
      if (!action) continue

      const ex = action.execute
      if (!ex || typeof ex !== 'object' || Array.isArray(ex)) continue
      if (ex.type !== 'animation') continue

      const animationGuid = typeof ex.guid === 'string' ? ex.guid : ''
      if (animationGuid && isAnimationPlaying(animationGuid)) return true
    }
    return false
  }
}
