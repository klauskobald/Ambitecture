import { PropertyControl } from './PropertyControl.js'
import { projectGraph } from '../../core/projectGraph.js'

const AXES = [
  { index: 0, label: 'X' },
  { index: 1, label: 'Y' },
  { index: 2, label: 'Z' },
]

/**
 * Three pill toggles (X / Y / Z) in one row for a vector3 whose components are 0 or 1.
 * Writes the full `[number, number, number]` array on each toggle.
 */
export class Vector3BooleanControl extends PropertyControl {
  constructor (descriptor, onCommit, selectionSize, writeTarget = null) {
    super(descriptor, onCommit, selectionSize, writeTarget)
    /** @type {HTMLButtonElement[]} */
    this._pills = []
  }

  /** @param {HTMLElement} area */
  _buildControlWidget (area) {
    const group = document.createElement('div')
    group.className = 'prop-pills'

    for (const axis of AXES) {
      const btn = document.createElement('button')
      btn.className = 'prop-pill intent-toggle prop-pill--vector3-bool'
      btn.textContent = axis.label
      btn.title = `Toggle ${axis.label}`
      btn.addEventListener('click', () => this._handleAxisClick(axis.index))
      group.appendChild(btn)
      this._pills.push(btn)
    }

    area.appendChild(group)
  }

  /** @param {{ mode: 'same'|'mixed'|'absent', value: unknown, enableState: string }} state */
  _applyState (state) {
    const arr = normalizeValue(state.mode === 'same' ? state.value : undefined)
    for (let i = 0; i < this._pills.length; i += 1) {
      const active = arr[i] === 1
      this._pills[i].classList.toggle('prop-pill--active', active)
      this._pills[i].classList.toggle('intent-toggle--enabled', active)
    }
  }

  /** @param {number} axisIndex */
  _handleAxisClick (axisIndex) {
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    for (const guid of this._currentGuids) {
      const currentArr = normalizeValue(
        this._readValue(guid, dotKey)
      )
      currentArr[axisIndex] = currentArr[axisIndex] === 1 ? 0 : 1
      this._updateProperty(guid, dotKey, currentArr)
    }
    this._saveProject()
    this.refresh(this._currentGuids)
  }

  /**
   * Read a value from the current write target or default intent path.
   * @param {string} guid
   * @param {string} dotKey
   * @returns {unknown}
   */
  _readValue (guid, dotKey) {
    if (this._writeTarget) {
      return this._writeTarget.read(guid, dotKey)
    }
    return projectGraph.getEffectiveIntentProperty(guid, dotKey)
  }
}

/**
 * Normalize to `[0|1, 0|1, 0|1]`. Missing/undefined → `[0, 0, 0]`.
 * @param {unknown} value
 * @returns {[number, number, number]}
 */
function normalizeValue (value) {
  if (Array.isArray(value)) {
    return [
      value[0] ? 1 : 0,
      value[1] ? 1 : 0,
      value[2] ? 1 : 0,
    ]
  }
  return [0, 0, 0]
}
