import { PropertyControl } from './PropertyControl.js'
import { projectGraph } from '../../core/projectGraph.js'
import { queueIntentUpdate } from '../../core/outboundQueue.js'
import { readAtDotPath, applyRelativeDelta } from './controlHelpers.js'

export class SliderControl extends PropertyControl {
  constructor (descriptor, onCommit) {
    super(descriptor, onCommit)
    /** @type {HTMLInputElement | null} */
    this._slider = null
    /** @type {'same' | 'mixed' | 'absent'} */
    this._mode = 'absent'
  }

  /** @param {HTMLElement} area */
  _buildControlWidget (area) {
    const wrapper = document.createElement('div')
    wrapper.className = 'prop-slider-wrapper'

    this._slider = document.createElement('input')
    this._slider.type = 'range'
    this._slider.className = 'prop-slider'
    this._slider.step = '0.01'

    this._slider.addEventListener('input', () => this._handleInput())

    wrapper.appendChild(this._slider)
    area.appendChild(wrapper)
  }

  /** @param {{ mode: 'same'|'mixed'|'absent', value: unknown, enableState: string }} state */
  _applyState (state) {
    if (!this._slider) return
    this._mode = state.mode

    const range = /** @type {number[] | undefined} */ (this._descriptor.range)
    const min = range?.[0] ?? 0
    const max = range?.[1] ?? 1

    if (state.mode === 'mixed') {
      this._slider.min = '-1'
      this._slider.max = '1'
      this._slider.step = '0.01'
      this._slider.value = '0'
      this._slider.className = 'prop-slider prop-slider--relative'
    } else {
      this._slider.min = String(min)
      this._slider.max = String(max)
      this._slider.step = String((max - min) > 2 ? 1 : 0.01)
      this._slider.value = state.mode === 'same' ? String(state.value ?? min) : String(min)
      this._slider.className = 'prop-slider'
    }
  }

  _handleInput () {
    if (!this._slider) return
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    const range = /** @type {number[] | undefined} */ (this._descriptor.range)
    const min = range?.[0] ?? 0
    const max = range?.[1] ?? 1
    const sliderVal = parseFloat(this._slider.value)
    const intents = projectGraph.getIntents()

    if (this._mode === 'mixed') {
      for (const guid of this._currentGuids) {
        const intent = /** @type {Record<string, unknown> | undefined} */ (intents.get(guid))
        if (!intent) continue
        const original = /** @type {number} */ (readAtDotPath(intent, dotKey) ?? min)
        const newVal = applyRelativeDelta(original, sliderVal, min, max)
        const updated = projectGraph.updateIntentProperty(guid, dotKey, newVal)
        if (updated) queueIntentUpdate(updated)
      }
    } else {
      for (const guid of this._currentGuids) {
        const updated = projectGraph.updateIntentProperty(guid, dotKey, sliderVal)
        if (updated) queueIntentUpdate(updated)
      }
    }
  }
}
