import { PropertyControl } from './PropertyControl.js'
import { projectGraph } from '../../core/projectGraph.js'
import { applyDelta } from './controlHelpers.js'
import { evaluate as fnEvaluate, inverse as fnInverse } from './fnCurve.js'

export class SliderControl extends PropertyControl {
  constructor (descriptor, onCommit, selectionSize) {
    super(descriptor, onCommit, selectionSize)
    /** @type {HTMLElement | null} */
    this._wrapper = null
    /** @type {HTMLElement | null} */
    this._track = null
    /** @type {HTMLElement | null} */
    this._fill = null
    /** @type {HTMLElement | null} */
    this._bubble = null
    /** @type {boolean} */
    this._isDelta = false
    /** @type {number} */
    this._t = 0
    /** @type {number} */
    this._absMin = 0
    /** @type {number} */
    this._absMax = 1
    /** @type {number} */
    this._absStep = 0.01
    /** @type {string | null} */
    this._stepFnName = null
    /** @type {number} */
    this._dMin = -1
    /** @type {number} */
    this._dMax = 1
    /** @type {number} */
    this._deltaStep = 0.01
    /** @type {AbortController | null} */
    this._abort = null
    /** @type {number | null} */
    this._dragPointerId = null
    /** @type {number} */
    this._dragStartX = 0
    /** @type {number} */
    this._dragStartT = 0
  }

  destroy () {
    this._abort?.abort()
    this._abort = null
  }

  /** @param {HTMLElement} area */
  _buildControlWidget (area) {
    this._abort = new AbortController()
    const signal = this._abort.signal

    const wrapper = document.createElement('div')
    wrapper.className = 'prop-slider-wrapper'
    this._wrapper = wrapper

    const track = document.createElement('div')
    track.className = 'prop-slider-track'
    track.tabIndex = 0
    track.setAttribute('role', 'slider')
    track.setAttribute('aria-orientation', 'horizontal')
    this._track = track

    const fill = document.createElement('div')
    fill.className = 'prop-slider-track__fill'
    fill.setAttribute('aria-hidden', 'true')
    this._fill = fill

    const bubble = document.createElement('div')
    bubble.className = 'prop-slider-bubble'
    bubble.setAttribute('aria-hidden', 'true')
    this._bubble = bubble

    track.appendChild(fill)
    track.appendChild(bubble)
    wrapper.appendChild(track)
    area.appendChild(wrapper)

    track.addEventListener('pointerdown', e => this._onPointerDown(e), { signal })
    track.addEventListener('pointermove', e => this._onPointerMove(e), { signal })
    track.addEventListener('pointerup', e => this._onPointerUp(e), { signal })
    track.addEventListener('pointercancel', e => this._onPointerUp(e), { signal })
    track.addEventListener('keydown', e => this._onKeyDown(e), { signal })
  }

  /**
   * @param {{ mode: 'same'|'mixed'|'absent', value: unknown, enableState: string, selectionSize: number }} state
   */
  _applyState (state) {
    if (!this._track || !this._bubble || !this._fill) return

    this._isDelta = state.mode === 'mixed' && state.selectionSize > 1

    const range = /** @type {number[] | undefined} */ (this._descriptor.range)
    const min = range?.[0] ?? 0
    const max = range?.[1] ?? 1
    const span = max - min

    if (this._isDelta) {
      const deltaConfig = this._getDeltaConfig()
      this._dMin = deltaConfig.range[0]
      this._dMax = deltaConfig.range[1]
      const dSpan = this._dMax - this._dMin
      this._deltaStep = this._resolveStep(deltaConfig.step, this._dMin, this._dMax)

      const noOp = deltaConfig.fn === 'MULTIPLY' ? 1 : 0
      this._t = dSpan !== 0 ? (noOp - this._dMin) / dSpan : 0
      this._t = Math.max(0, Math.min(1, this._t))

      this._track.className = 'prop-slider-track prop-slider-track--relative'
      this._setAriaDelta()
      this._syncVisualFromT()
      this._refreshBubbleLabel()
    } else {
      this._absMin = min
      this._absMax = max
      this._absStep = this._resolveStep(this._descriptor.step, min, max)
      const rawFn = this._descriptor.stepFunction
      this._stepFnName = typeof rawFn === 'string' && rawFn.length > 0 ? rawFn : null

      if (state.mode === 'same' && state.value !== undefined && span !== 0) {
        const v = Number(state.value)
        const u = (v - min) / span
        this._t = fnInverse(this._stepFnName, u)
      } else {
        this._t = 0
      }
      this._t = Math.max(0, Math.min(1, this._t))

      this._track.className = 'prop-slider-track'
      this._setAriaAbsolute()
      this._syncVisualFromT()
      this._refreshBubbleLabel()
    }
  }

  _refreshBubbleLabel () {
    if (!this._bubble) return
    if (this._isDelta) {
      const dSpan = this._dMax - this._dMin
      const dv = this._dMin + this._t * dSpan
      this._bubble.textContent = this._formatDisplay(dv, this._deltaStep)
    } else {
      const v = this._absoluteValueFromT(this._t)
      this._bubble.textContent = this._formatDisplay(v, this._absStep)
    }
  }

  /** @param {PointerEvent} e */
  _onPointerDown (e) {
    if (!this._track) return
    if (e.button !== 0) return
    this._dragPointerId = e.pointerId
    this._dragStartX = e.clientX
    this._dragStartT = this._t
    this._track.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  /** @param {PointerEvent} e */
  _onPointerMove (e) {
    if (this._dragPointerId !== e.pointerId || !this._track) return
    const rect = this._track.getBoundingClientRect()
    const width = rect.width
    if (width <= 0) return
    const dx = e.clientX - this._dragStartX
    this._t = Math.max(0, Math.min(1, this._dragStartT + dx / width))
    this._commitFromT()
    e.preventDefault()
  }

  /** @param {PointerEvent} e */
  _onPointerUp (e) {
    if (this._dragPointerId !== e.pointerId || !this._track) return
    this._track.releasePointerCapture(e.pointerId)
    this._dragPointerId = null
    this._saveProject()
    e.preventDefault()
  }

  /** @param {KeyboardEvent} e */
  _onKeyDown (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const dir = e.key === 'ArrowRight' ? 1 : -1
    if (this._isDelta) {
      const dSpan = this._dMax - this._dMin
      let cur = this._dMin + this._t * dSpan
      cur = this._snap(cur, this._dMin, this._dMax, this._deltaStep)
      const next = this._snap(cur + dir * this._deltaStep, this._dMin, this._dMax, this._deltaStep)
      this._t = dSpan !== 0 ? (next - this._dMin) / dSpan : 0
      this._t = Math.max(0, Math.min(1, this._t))
    } else {
      const span = this._absMax - this._absMin
      if (span === 0) return
      const cur = this._absoluteValueFromT(this._t)
      const next = this._snap(cur + dir * this._absStep, this._absMin, this._absMax, this._absStep)
      const u = (next - this._absMin) / span
      this._t = fnInverse(this._stepFnName, u)
      this._t = Math.max(0, Math.min(1, this._t))
    }
    this._commitFromT()
    this._saveProject()
  }

  _commitFromT () {
    if (this._isDelta) {
      const dSpan = this._dMax - this._dMin
      let deltaVal = this._dMin + this._t * dSpan
      deltaVal = this._snap(deltaVal, this._dMin, this._dMax, this._deltaStep)
      if (dSpan !== 0) {
        this._t = (deltaVal - this._dMin) / dSpan
      }
      this._applyDeltaValue(deltaVal)
      if (this._bubble) {
        this._bubble.textContent = this._formatDisplay(deltaVal, this._deltaStep)
      }
      if (this._track) {
        this._track.setAttribute('aria-valuenow', String(deltaVal))
      }
    } else {
      const v = this._absoluteValueFromT(this._t)
      const span = this._absMax - this._absMin
      if (span > 0) {
        const u = (v - this._absMin) / span
        this._t = fnInverse(this._stepFnName, u)
      }
      this._applyAbsoluteValue(v)
      if (this._bubble) {
        this._bubble.textContent = this._formatDisplay(v, this._absStep)
      }
      if (this._track) {
        this._track.setAttribute('aria-valuenow', String(v))
      }
    }
    this._syncVisualFromT()
  }

  _syncVisualFromT () {
    if (!this._fill || !this._bubble) return
    const pct = this._t * 100
    this._fill.style.width = `${pct}%`
    this._bubble.style.left = `${pct}%`
  }

  /**
   * @param {number} t
   * @returns {number}
   */
  _absoluteValueFromT (t) {
    const span = this._absMax - this._absMin
    if (span === 0) return this._absMin
    const u = this._stepFnName == null ? t : fnEvaluate(this._stepFnName, t)
    const raw = this._absMin + span * u
    return this._snap(raw, this._absMin, this._absMax, this._absStep)
  }

  /**
   * @param {number} v
   */
  _applyAbsoluteValue (v) {
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    for (const guid of this._currentGuids) {
      this._updateProperty(guid, dotKey, v)
    }
  }

  /**
   * @param {number} deltaVal
   */
  _applyDeltaValue (deltaVal) {
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    const range = /** @type {number[] | undefined} */ (this._descriptor.range)
    const min = range?.[0] ?? 0
    const max = range?.[1] ?? 1
    const { fn } = this._getDeltaConfig()
    for (const guid of this._currentGuids) {
      const original = /** @type {number} */ (projectGraph.getEffectiveIntentProperty(guid, dotKey) ?? min)
      const newVal = applyDelta(original, deltaVal, fn, min, max)
      this._updateProperty(guid, dotKey, newVal)
    }
  }

  _setAriaAbsolute () {
    if (!this._track) return
    this._track.setAttribute('aria-valuemin', String(this._absMin))
    this._track.setAttribute('aria-valuemax', String(this._absMax))
    const v = this._absoluteValueFromT(this._t)
    this._track.setAttribute('aria-valuenow', String(v))
  }

  _setAriaDelta () {
    if (!this._track) return
    this._track.setAttribute('aria-valuemin', String(this._dMin))
    this._track.setAttribute('aria-valuemax', String(this._dMax))
    const dSpan = this._dMax - this._dMin
    const cur = this._dMin + this._t * dSpan
    this._track.setAttribute('aria-valuenow', String(cur))
  }

  /**
   * @param {unknown} explicit
   * @param {number} rangeMin
   * @param {number} rangeMax
   * @returns {number}
   */
  _resolveStep (explicit, rangeMin, rangeMax) {
    if (explicit !== undefined && explicit !== null && Number.isFinite(Number(explicit))) {
      const s = Number(explicit)
      return s > 0 ? s : (rangeMax - rangeMin) / 255
    }
    const span = rangeMax - rangeMin
    return span / 255
  }

  /**
   * @param {number} value
   * @param {number} min
   * @param {number} max
   * @param {number} step
   * @returns {number}
   */
  _snap (value, min, max, step) {
    if (!Number.isFinite(value)) return min
    const s = step > 0 ? step : (max - min) / 255
    const snapped = min + Math.round((value - min) / s) * s
    return Math.max(min, Math.min(max, snapped))
  }

  /**
   * @param {number} value
   * @param {number} step
   * @returns {string}
   */
  _formatDisplay (value, step) {
    if (!Number.isFinite(value)) return ''
    const s = Number(step)
    if (s >= 1) return String(Math.round(value))
    const str = String(s)
    const dot = str.indexOf('.')
    const dec = dot < 0 ? 0 : Math.min(6, str.length - dot - 1)
    return String(Number(value.toFixed(dec)))
  }

  /** @returns {{ fn: string, range: [number, number], step?: number }} */
  _getDeltaConfig () {
    const delta = /** @type {Record<string, unknown> | undefined} */ (this._descriptor.delta)
    const channel = /** @type {Record<string, unknown> | undefined} */ (delta?.['value'])
    if (channel) {
      const stepRaw = channel.step
      const step = stepRaw !== undefined && Number.isFinite(Number(stepRaw)) ? Number(stepRaw) : undefined
      return {
        fn: String(channel.fn ?? 'ADD'),
        range: /** @type {[number, number]} */ (Array.isArray(channel.range) ? channel.range : [-1, 1]),
        step
      }
    }
    return { fn: 'ADD', range: [-1, 1] }
  }
}
