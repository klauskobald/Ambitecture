import { PerformButton } from './PerformButton.js'

export class PerformButtonSnapshot extends PerformButton {
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

  /** @returns {boolean} */
  _isHighlighted () {
    return false
  }
}
