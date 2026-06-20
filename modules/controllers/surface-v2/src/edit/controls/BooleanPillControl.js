import { PropertyControl } from './PropertyControl.js'
import { projectGraph } from '../../core/projectGraph.js'
import { markStageOverlayActivity } from '../../stage/stageOverlayHost.js'

/**
 * Boolean property rendered as a single toggle pill (label = descriptor `name`) for placement
 * inside a shared `host` card. Unlike the row controls it has no header / label / control-area
 * chrome — it builds just the pill via {@link buildPill}; click flips the boolean.
 */
export class BooleanPillControl extends PropertyControl {
  /**
   * @param {Record<string, unknown>} descriptor
   * @param {(dotKey: string, guids: Set<string>, value: unknown) => void} onCommit
   * @param {number} selectionSize
   * @param {import('./PropertyControl.js').PropertyControl['_writeTarget']} [writeTarget]
   */
  constructor (descriptor, onCommit, selectionSize, writeTarget = null) {
    super(descriptor, onCommit, selectionSize, writeTarget)
    /** @type {HTMLButtonElement | null} */
    this._pill = null
  }

  /** @returns {HTMLButtonElement} */
  buildPill () {
    const pill = document.createElement('button')
    pill.type = 'button'
    pill.className = 'prop-pill intent-toggle'
    pill.textContent = String(this._descriptor.name ?? this._descriptor.dotKey)
    pill.addEventListener('click', () => this._onPillClick())
    this._pill = pill
    return pill
  }

  /** @param {Set<string>} guids */
  refresh (guids) {
    this._currentGuids = guids
    if (!this._pill) return
    const on = this._readBoolean(guids)
    this._pill.classList.toggle('prop-pill--active', on)
    this._pill.classList.toggle('intent-toggle--enabled', on)
    this._pill.setAttribute('aria-pressed', on ? 'true' : 'false')
  }

  destroy () {
    this._pill = null
  }

  _onPillClick () {
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    const next = !this._readBoolean(this._currentGuids)
    for (const guid of this._currentGuids) {
      this._updateProperty(guid, dotKey, next)
    }
    this._saveProject()
    markStageOverlayActivity()
    this.refresh(this._currentGuids)
  }

  /**
   * @param {Set<string>} guids
   * @returns {boolean} on only when every selected target reads `true` (multi-select: all-on).
   */
  _readBoolean (guids) {
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    let total = 0
    let onCount = 0
    for (const guid of guids) {
      total++
      const raw = this._writeTarget
        ? this._writeTarget.read(guid, dotKey)
        : projectGraph.getEffectiveIntentProperty(guid, dotKey)
      if (raw === true) onCount++
    }
    return total > 0 && onCount === total
  }
}
