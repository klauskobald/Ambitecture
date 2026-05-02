import { PropertyControl } from './PropertyControl.js'

export class InfoTextControl extends PropertyControl {
  constructor (descriptor, onCommit, selectionSize) {
    super(descriptor, onCommit, selectionSize)
    /** @type {HTMLElement | null} */
    this._valueEl = null
  }

  /** @param {HTMLElement} area */
  _buildControlWidget (area) {
    this._valueEl = document.createElement('div')
    this._valueEl.className = 'prop-info-text'
    this._valueEl.textContent = '—'
    area.appendChild(this._valueEl)
  }

  /** @param {{ mode: 'same'|'mixed'|'absent', value: unknown, enableState: string }} state */
  _applyState (state) {
    if (!this._valueEl) return
    switch (state.mode) {
      case 'same':
        this._valueEl.textContent = formatInfoValue(state.value)
        break
      case 'mixed':
        this._valueEl.textContent = 'Mixed'
        break
      case 'absent':
        this._valueEl.textContent = '—'
        break
    }
  }
}

/** @param {unknown} value */
function formatInfoValue (value) {
  if (Array.isArray(value)) return value.map(formatNumber).join(', ')
  if (value && typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'number') return formatNumber(value)
  return String(value ?? '')
}

/** @param {unknown} value */
function formatNumber (value) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return String(value)
  return Number.isInteger(numberValue) ? String(numberValue) : numberValue.toFixed(2)
}
