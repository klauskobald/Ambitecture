import { PropertyControl } from './PropertyControl.js'
import { ColorPicker } from '../../ui/colorPicker.js'
import { hslPalette } from '../../ui/palettes/hslPalette.js'
import { projectGraph } from '../../core/projectGraph.js'
import { queueIntentUpdate } from '../../core/outboundQueue.js'
import { toHSL, toCSSRGB } from '../../core/color.js'
import { readAtDotPath } from './controlHelpers.js'

export class ColorControl extends PropertyControl {
  constructor (descriptor, onCommit) {
    super(descriptor, onCommit)
    this._colorPicker = new ColorPicker([hslPalette])
    /** @type {HTMLButtonElement | null} */
    this._swatch = null
    /** @type {HTMLElement | null} */
    this._relativeArea = null
    /** @type {'same' | 'mixed' | 'absent'} */
    this._mode = 'absent'
    /** @type {HTMLInputElement[]} */
    this._relSliders = []
  }

  /** @param {HTMLElement} area */
  _buildControlWidget (area) {
    this._swatch = document.createElement('button')
    this._swatch.className = 'prop-color-swatch'
    this._swatch.setAttribute('aria-label', 'Pick color')
    this._swatch.addEventListener('click', () => this._openPicker())
    area.appendChild(this._swatch)

    this._relativeArea = document.createElement('div')
    this._relativeArea.className = 'prop-relative-hsl'
    this._relativeArea.hidden = true

    const labels = ['ΔH', 'ΔS', 'ΔL']
    const mins = [-180, -1, -1]
    const maxs = [180, 1, 1]
    const keys = ['h', 's', 'l']

    for (let i = 0; i < 3; i++) {
      const row = document.createElement('div')
      row.className = 'prop-relative-row'

      const lbl = document.createElement('span')
      lbl.className = 'prop-relative-label'
      lbl.textContent = /** @type {string} */ (labels[i])

      const slider = document.createElement('input')
      slider.type = 'range'
      slider.className = 'prop-slider prop-slider--relative'
      slider.min = String(/** @type {number} */ (mins[i]))
      slider.max = String(/** @type {number} */ (maxs[i]))
      slider.step = i === 0 ? '1' : '0.01'
      slider.value = '0'
      slider.dataset.channel = /** @type {string} */ (keys[i])
      slider.addEventListener('input', () => this._handleRelativeSlider(slider))

      row.appendChild(lbl)
      row.appendChild(slider)
      this._relativeArea.appendChild(row)
      this._relSliders.push(slider)
    }

    area.appendChild(this._relativeArea)
  }

  /** @param {{ mode: 'same'|'mixed'|'absent', value: unknown, enableState: string }} state */
  _applyState (state) {
    this._mode = state.mode
    const isRelative = state.mode === 'mixed'

    if (this._swatch) this._swatch.hidden = isRelative
    if (this._relativeArea) this._relativeArea.hidden = !isRelative

    if (!isRelative && this._swatch) {
      const cssColor = state.mode === 'same' ? toCSSRGB(state.value) : 'rgb(60,60,60)'
      this._swatch.style.background = cssColor
    }

    if (isRelative) {
      for (const slider of this._relSliders) slider.value = '0'
    }
  }

  _openPicker () {
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    const intents = projectGraph.getIntents()
    const firstGuid = [...this._currentGuids][0]
    if (!firstGuid) return
    const intent = /** @type {Record<string, unknown> | undefined} */ (intents.get(firstGuid))
    const currentColor = intent ? readAtDotPath(intent, dotKey) : null

    this._colorPicker.open(currentColor ?? { h: 0, s: 1, l: 0.25 }, rawColor => {
      const dotKey2 = /** @type {string} */ (this._descriptor.dotKey)
      for (const guid of this._currentGuids) {
        const updated = projectGraph.updateIntentProperty(guid, dotKey2, rawColor)
        if (updated) queueIntentUpdate(updated)
      }
      if (this._swatch) this._swatch.style.background = toCSSRGB(rawColor)
    })
  }

  /** @param {HTMLInputElement} slider */
  _handleRelativeSlider (slider) {
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    const channel = slider.dataset.channel
    const delta = parseFloat(slider.value)
    const intents = projectGraph.getIntents()

    for (const guid of this._currentGuids) {
      const intent = /** @type {Record<string, unknown> | undefined} */ (intents.get(guid))
      if (!intent) continue
      const currentColor = readAtDotPath(intent, dotKey)
      const hsl = toHSL(currentColor)

      let newH = hsl.h, newS = hsl.s, newL = hsl.l
      switch (channel) {
        case 'h': newH = ((hsl.h + delta) % 360 + 360) % 360; break
        case 's': newS = Math.max(0, Math.min(1, hsl.s + delta)); break
        case 'l': newL = Math.max(0, Math.min(1, hsl.l + delta)); break
      }

      const updated = projectGraph.updateIntentProperty(guid, dotKey, { h: newH, s: newS, l: newL })
      if (updated) queueIntentUpdate(updated)
    }
  }

  destroy () {
    this._colorPicker.close()
  }
}
