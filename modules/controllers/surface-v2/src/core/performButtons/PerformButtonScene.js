import { PerformButton } from './PerformButton.js'
import { projectGraph, inputActionGuidList } from '../projectGraph.js'

export class PerformButtonScene extends PerformButton {
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
   * True when this input is the active scene's linked perform button.
   * @returns {boolean}
   */
  _isHighlighted () {
    if (!this._inputGuid) return false
    const activeSceneName = projectGraph.getActiveSceneName()
    const activeSceneGuid = activeSceneName
      ? projectGraph.getSceneGuid(activeSceneName)
      : null
    const scenePerformInput =
      activeSceneGuid && projectGraph.getSceneButtonInput(activeSceneGuid)
    const highlightedGuid = scenePerformInput
      ? String(scenePerformInput.guid ?? '')
      : ''
    return highlightedGuid !== '' && highlightedGuid === this._inputGuid
  }
}
