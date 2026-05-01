import { PropertyControl } from './PropertyControl.js'
import { hslPalette } from '../../ui/palettes/hslPalette.js'
import { projectGraph } from '../../core/projectGraph.js'
import { queueIntentUpdate } from '../../core/outboundQueue.js'
import { toHSL } from '../../core/color.js'
import { readAtDotPath, applyDelta } from './controlHelpers.js'

const HSL_CHANNEL_DEFAULTS = {
  h: { fn: 'ADD', range: /** @type {[number, number]} */ ([-10, 10]),   label: 'ΔH', step: '1',    wrap: true },
  s: { fn: 'ADD', range: /** @type {[number, number]} */ ([-0.1, 0.1]), label: 'ΔS', step: '0.01', wrap: false },
  l: { fn: 'ADD', range: /** @type {[number, number]} */ ([-0.1, 0.1]), label: 'ΔL', step: '0.01', wrap: false },
}

export class ColorControl extends PropertyControl {
  constructor (descriptor, onCommit, selectionSize) {
    super(descriptor, onCommit, selectionSize)
    /** @type {{ setColor: (c: unknown) => void, destroy: () => void } | null} */
    this._paletteInstance = null
    /** @type {HTMLElement | null} */
    this._inlineArea = null
    // Delta sliders are only built when selectionSize > 1
    /** @type {HTMLElement | null} */
    this._relativeArea = null
    /** @type {HTMLInputElement[]} */
    this._relSliders = []
  }

  /** @param {HTMLElement} area */
  _buildControlWidget (area) {
    // Absolute mode: inline HSL palette (always built)
    this._inlineArea = document.createElement('div')
    this._inlineArea.className = 'prop-color-inline'
    this._paletteInstance = hslPalette.mount(this._inlineArea, rawColor => {
      const dotKey = /** @type {string} */ (this._descriptor.dotKey)
      for (const guid of this._currentGuids) {
        const updated = projectGraph.updateIntentProperty(guid, dotKey, rawColor)
        if (updated) queueIntentUpdate(updated)
      }
    })
    // Save project when user lifts finger/mouse from palette
    this._inlineArea.addEventListener('pointerup', () => this._saveProject())
    area.appendChild(this._inlineArea)

    // Delta mode: relative sliders — only built for multi-selection
    if (this._selectionSize > 1) {
      this._relativeArea = document.createElement('div')
      this._relativeArea.className = 'prop-relative-hsl'
      this._relativeArea.hidden = true
      this._buildDeltaSliders(this._relativeArea)
      area.appendChild(this._relativeArea)
    }
  }

  /** @param {HTMLElement} container */
  _buildDeltaSliders (container) {
    const configs = this._getChannelConfigs()
    for (const [channelKey, cfg] of Object.entries(configs)) {
      const row = document.createElement('div')
      row.className = 'prop-relative-row'

      const lbl = document.createElement('span')
      lbl.className = 'prop-relative-label'
      lbl.textContent = cfg.label

      const noOpValue = cfg.fn === 'MULTIPLY' ? '1' : '0'
      const slider = document.createElement('input')
      slider.type = 'range'
      slider.className = 'prop-slider prop-slider--relative'
      slider.min = String(cfg.range[0])
      slider.max = String(cfg.range[1])
      slider.step = cfg.step
      slider.value = noOpValue
      slider.dataset.channel = channelKey
      slider.dataset.fn = cfg.fn
      slider.dataset.wrap = cfg.wrap ? 'true' : 'false'
      slider.addEventListener('input', () => this._handleRelativeSlider(slider))
      slider.addEventListener('change', () => this._saveProject())

      row.appendChild(lbl)
      row.appendChild(slider)
      container.appendChild(row)
      this._relSliders.push(slider)
    }
  }

  /** @param {{ mode: 'same'|'mixed'|'absent', value: unknown, enableState: string, selectionSize: number }} state */
  _applyState (state) {
    const isDelta = state.mode === 'mixed' && state.selectionSize > 1

    if (this._inlineArea) this._inlineArea.hidden = isDelta
    if (this._relativeArea) this._relativeArea.hidden = !isDelta

    if (!isDelta && this._paletteInstance) {
      if (state.mode === 'same' && state.value !== undefined) {
        this._paletteInstance.setColor(state.value)
      }
    }

    if (isDelta) {
      for (const slider of this._relSliders) {
        slider.value = slider.dataset.fn === 'MULTIPLY' ? '1' : '0'
      }
    }
  }

  /** @param {HTMLInputElement} slider */
  _handleRelativeSlider (slider) {
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    const channel = /** @type {string} */ (slider.dataset.channel)
    const fn = slider.dataset.fn ?? 'ADD'
    const wrap = slider.dataset.wrap === 'true'
    const delta = parseFloat(slider.value)
    const intents = projectGraph.getIntents()
    const absRange = this._getAbsoluteRange()

    for (const guid of this._currentGuids) {
      const intent = /** @type {Record<string, unknown> | undefined} */ (intents.get(guid))
      if (!intent) continue
      const currentColor = readAtDotPath(intent, dotKey)
      const hsl = toHSL(currentColor)

      let newH = hsl.h, newS = hsl.s, newL = hsl.l
      switch (channel) {
        case 'h': {
          const [hMin, hMax] = absRange.h
          if (wrap) {
            const period = hMax - hMin
            const raw = fn === 'MULTIPLY' ? hsl.h * delta : hsl.h + delta
            newH = ((raw - hMin) % period + period) % period + hMin
          } else {
            newH = applyDelta(hsl.h, delta, fn, hMin, hMax)
          }
          break
        }
        case 's': {
          const [sMin, sMax] = absRange.s
          newS = applyDelta(hsl.s, delta, fn, sMin, sMax)
          break
        }
        case 'l': {
          const [lMin, lMax] = absRange.l
          newL = applyDelta(hsl.l, delta, fn, lMin, lMax)
          break
        }
      }

      const updated = projectGraph.updateIntentProperty(guid, dotKey, { h: newH, s: newS, l: newL })
      if (updated) queueIntentUpdate(updated)
    }
  }

  /** @returns {{ h: [number, number], s: [number, number], l: [number, number] }} */
  _getAbsoluteRange () {
    const r = /** @type {Record<string, unknown> | undefined} */ (this._descriptor.range)
    return {
      h: Array.isArray(r?.h) ? /** @type {[number, number]} */ (r.h) : [0, 360],
      s: Array.isArray(r?.s) ? /** @type {[number, number]} */ (r.s) : [0, 1],
      l: Array.isArray(r?.l) ? /** @type {[number, number]} */ (r.l) : [0, 1],
    }
  }

  /**
   * @returns {Record<string, { fn: string, range: [number, number], label: string, step: string, wrap: boolean }>}
   */
  _getChannelConfigs () {
    const delta = /** @type {Record<string, unknown> | undefined} */ (this._descriptor.delta)
    const result = /** @type {typeof HSL_CHANNEL_DEFAULTS} */ ({})
    for (const [key, defaults] of Object.entries(HSL_CHANNEL_DEFAULTS)) {
      const override = /** @type {Record<string, unknown> | undefined} */ (delta?.[key])
      result[key] = {
        ...defaults,
        fn: typeof override?.fn === 'string' ? override.fn : defaults.fn,
        range: Array.isArray(override?.range) ? /** @type {[number, number]} */ (override.range) : defaults.range,
      }
    }
    return result
  }

  destroy () {
    this._paletteInstance?.destroy()
    this._paletteInstance = null
  }
}
