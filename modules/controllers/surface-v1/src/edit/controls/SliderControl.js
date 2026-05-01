import { PropertyControl } from './PropertyControl.js'
import { projectGraph } from '../../core/projectGraph.js'
import { queueIntentUpdate } from '../../core/outboundQueue.js'
import { readAtDotPath, applyDelta } from './controlHelpers.js'

export class SliderControl extends PropertyControl {
  constructor (descriptor, onCommit, selectionSize) {
    super(descriptor, onCommit, selectionSize)
    /** @type {HTMLInputElement | null} */
    this._slider = null
    /** @type {boolean} */
    this._isDelta = false
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
    // save project when user finishes dragging
    this._slider.addEventListener('change', () => this._saveProject())

    wrapper.appendChild(this._slider)
    area.appendChild(wrapper)
  }

  /** @param {{ mode: 'same'|'mixed'|'absent', value: unknown, enableState: string, selectionSize: number }} state */
  _applyState (state) {
    if (!this._slider) return

    this._isDelta = state.mode === 'mixed' && state.selectionSize > 1

    const range = /** @type {number[] | undefined} */ (this._descriptor.range)
    const min = range?.[0] ?? 0
    const max = range?.[1] ?? 1

    if (this._isDelta) {
      const deltaConfig = this._getDeltaConfig()
      const noOpValue = deltaConfig.fn === 'MULTIPLY' ? '1' : '0'
      this._slider.min = String(deltaConfig.range[0])
      this._slider.max = String(deltaConfig.range[1])
      this._slider.step = '0.01'
      this._slider.value = noOpValue
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

    if (this._isDelta) {
      const { fn } = this._getDeltaConfig()
      for (const guid of this._currentGuids) {
        const intent = /** @type {Record<string, unknown> | undefined} */ (intents.get(guid))
        if (!intent) continue
        const original = /** @type {number} */ (readAtDotPath(intent, dotKey) ?? min)
        const newVal = applyDelta(original, sliderVal, fn, min, max)
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

  /** @returns {{ fn: string, range: [number, number] }} */
  _getDeltaConfig () {
    const delta = /** @type {Record<string, unknown> | undefined} */ (this._descriptor.delta)
    const channel = /** @type {Record<string, unknown> | undefined} */ (delta?.['value'])
    if (channel) {
      return {
        fn: String(channel.fn ?? 'ADD'),
        range: /** @type {[number, number]} */ (Array.isArray(channel.range) ? channel.range : [-1, 1])
      }
    }
    return { fn: 'ADD', range: [-1, 1] }
  }
}
