/**
 * Drag-only scalar track + value bubble (relative pointer scrub, optional stepFunction via valueAtT/tAtValue).
 * Shared by SliderControl and ColorControl delta rows.
 */

/**
 * @typedef {object} ScalarDragSliderOptions
 * @property {number} min
 * @property {number} max
 * @property {number} [step] explicit step; if omitted, (max-min)/255
 * @property {number} value initial domain value
 * @property {'linear'} [mapping] reset to linear min↔max mapping (default when valueAtT/tAtValue omitted in constructor)
 * @property {(t: number) => number} [valueAtT] normalized t [0,1] → snapped domain value
 * @property {(v: number) => number} [tAtValue] domain value → t [0,1]
 * @property {number} [bubbleCharWidth] px per character for width estimate
 * @property {boolean} [relativeTrack] use prop-slider-track--relative styling
 * @property {(value: number) => void} onInput
 * @property {() => void} onCommit
 */

export class ScalarDragSlider {
  /**
   * @param {ScalarDragSliderOptions} opts
   */
  constructor (opts) {
    this._min = opts.min
    this._max = opts.max
    this._step = this._resolveStep(opts.step, opts.min, opts.max)
    /** @type {(t: number) => number} */
    this._valueAtT = (t) => this._linearValueAtT(t)
    /** @type {(v: number) => number} */
    this._tAtValue = (v) => this._linearTAtValue(v)
    if (opts.valueAtT !== undefined) this._valueAtT = opts.valueAtT
    if (opts.tAtValue !== undefined) this._tAtValue = opts.tAtValue
    this._bubbleCharWidthOpt = opts.bubbleCharWidth
    this._relativeTrack = opts.relativeTrack === true
    this._onInput = opts.onInput
    this._onCommit = opts.onCommit

    /** @type {HTMLElement | null} */
    this._wrapper = null
    /** @type {HTMLElement | null} */
    this._track = null
    /** @type {HTMLElement | null} */
    this._fill = null
    /** @type {HTMLElement | null} */
    this._bubble = null
    /** @type {number} */
    this._t = 0
    /** @type {AbortController | null} */
    this._abort = null
    /** @type {number | null} */
    this._dragPointerId = null
    /** @type {number} */
    this._dragStartX = 0
    /** @type {number} */
    this._dragStartT = 0
    /** @type {number} */
    this._dragSlidePx = 1
    /** @type {number} */
    this._displayDecimals = 2
    /** @type {number} */
    this._bubbleWidthPx = 32

    this._displayDecimals = this._decimalPlacesFromStep(this._step)
    this._setTFromDomainValue(opts.value)
  }

  /**
   * @param {Partial<ScalarDragSliderOptions> & { value?: number }} patch
   */
  configure (patch) {
    if (patch.min !== undefined) this._min = patch.min
    if (patch.max !== undefined) this._max = patch.max
    if (patch.step !== undefined) this._step = this._resolveStep(patch.step, this._min, this._max)
    if (patch.mapping === 'linear') {
      this._valueAtT = (t) => this._linearValueAtT(t)
      this._tAtValue = (v) => this._linearTAtValue(v)
    }
    if (patch.valueAtT !== undefined) this._valueAtT = patch.valueAtT
    if (patch.tAtValue !== undefined) this._tAtValue = patch.tAtValue
    if (patch.bubbleCharWidth !== undefined) this._bubbleCharWidthOpt = patch.bubbleCharWidth
    if (patch.relativeTrack !== undefined) this._relativeTrack = patch.relativeTrack === true
    if (patch.onInput !== undefined) this._onInput = patch.onInput
    if (patch.onCommit !== undefined) this._onCommit = patch.onCommit

    this._displayDecimals = this._decimalPlacesFromStep(this._step)
    if (patch.value !== undefined) {
      this._setTFromDomainValue(patch.value)
    }
    this._applyTrackClass()
    this._applyBubbleFixedWidth()
    this._setAria()
    this._syncVisualFromT()
    this._refreshBubbleLabel()
  }

  /**
   * @param {HTMLElement} parent
   * @returns {HTMLElement}
   */
  mount (parent) {
    this._abort = new AbortController()
    const signal = this._abort.signal

    const wrapper = document.createElement('div')
    wrapper.className = 'prop-slider-wrapper'
    this._wrapper = wrapper

    const track = document.createElement('div')
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
    parent.appendChild(wrapper)

    this._applyTrackClass()
    this._applyBubbleFixedWidth()
    this._setAria()
    this._syncVisualFromT()
    this._refreshBubbleLabel()

    track.addEventListener('pointerdown', e => this._onPointerDown(e), { signal })
    track.addEventListener('pointermove', e => this._onPointerMove(e), { signal })
    track.addEventListener('pointerup', e => this._onPointerUp(e), { signal })
    track.addEventListener('pointercancel', e => this._onPointerUp(e), { signal })
    track.addEventListener('keydown', e => this._onKeyDown(e), { signal })

    return wrapper
  }

  /**
   * @param {number} v domain value (snapped to current mapping)
   */
  setDomainValue (v) {
    this._setTFromDomainValue(v)
    this._applyBubbleFixedWidth()
    this._setAria()
    this._syncVisualFromT()
    this._refreshBubbleLabel()
  }

  destroy () {
    this._abort?.abort()
    this._abort = null
    this._wrapper = null
    this._track = null
    this._fill = null
    this._bubble = null
  }

  _applyTrackClass () {
    if (!this._track) return
    this._track.className = this._relativeTrack
      ? 'prop-slider-track prop-slider-track--relative'
      : 'prop-slider-track'
  }

  /**
   * @param {number} v
   */
  _setTFromDomainValue (v) {
    const num = Number(v)
    this._t = Number.isFinite(num) ? this._tAtValue(num) : 0
    this._t = Math.max(0, Math.min(1, this._t))
  }

  /**
   * @param {number} t
   * @returns {number}
   */
  _linearValueAtT (t) {
    const span = this._max - this._min
    const raw = this._min + t * span
    return this._snap(raw)
  }

  /**
   * @param {number} v
   * @returns {number}
   */
  _linearTAtValue (v) {
    const span = this._max - this._min
    if (span === 0) return 0
    const s = this._snap(v)
    return (s - this._min) / span
  }

  /** @param {PointerEvent} e */
  _onPointerDown (e) {
    if (!this._track) return
    if (e.button !== 0) return
    this._dragPointerId = e.pointerId
    this._dragStartX = e.clientX
    this._dragStartT = this._t
    this._dragSlidePx = this._slideWidthPx()
    this._track.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  /** @param {PointerEvent} e */
  _onPointerMove (e) {
    if (this._dragPointerId !== e.pointerId || !this._track) return
    const slidePx = this._dragSlidePx
    if (slidePx <= 0) return
    const dx = e.clientX - this._dragStartX
    this._t = Math.max(0, Math.min(1, this._dragStartT + dx / slidePx))
    this._commitFromT()
    e.preventDefault()
  }

  /** @param {PointerEvent} e */
  _onPointerUp (e) {
    if (this._dragPointerId !== e.pointerId || !this._track) return
    this._track.releasePointerCapture(e.pointerId)
    this._dragPointerId = null
    this._onCommit()
    e.preventDefault()
  }

  /** @param {KeyboardEvent} e */
  _onKeyDown (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const dir = e.key === 'ArrowRight' ? 1 : -1
    let cur = this._valueAtT(this._t)
    cur = this._snap(cur)
    const next = this._snap(cur + dir * this._step)
    this._t = this._tAtValue(next)
    this._t = Math.max(0, Math.min(1, this._t))
    this._commitFromT()
    this._onCommit()
  }

  _commitFromT () {
    let v = this._valueAtT(this._t)
    v = this._snap(v)
    this._t = this._tAtValue(v)
    this._t = Math.max(0, Math.min(1, this._t))
    this._onInput(v)
    if (this._bubble) {
      this._bubble.textContent = this._formatDisplayFixed(v)
    }
    if (this._track) {
      this._track.setAttribute('aria-valuenow', String(v))
    }
    this._syncVisualFromT()
  }

  _syncVisualFromT () {
    if (!this._fill || !this._bubble || !this._track) return
    const rect = this._track.getBoundingClientRect()
    const W = rect.width
    if (W <= 0) return
    const halfBubble = this._bubbleHalfWidthPx(W)
    const usable = Math.max(0, W - 2 * halfBubble)
    const centerX = halfBubble + this._t * usable
    const leftPct = (centerX / W) * 100
    this._fill.style.width = `${leftPct}%`
    this._bubble.style.left = `${leftPct}%`
  }

  /** @returns {number} */
  _slideWidthPx () {
    if (!this._track) return 1
    const W = this._track.getBoundingClientRect().width
    if (W <= 0) return 1
    const halfBubble = this._bubbleHalfWidthPx(W)
    return Math.max(1, W - 2 * halfBubble)
  }

  /**
   * @param {number} trackWidthPx
   * @returns {number}
   */
  _bubbleHalfWidthPx (trackWidthPx) {
    const w = this._bubbleWidthPx
    const half = w / 2
    const maxHalf = Math.max(0, trackWidthPx / 2 - 0.5)
    return Math.min(half, maxHalf)
  }

  _applyBubbleFixedWidth () {
    if (!this._bubble) return
    const dec = this._displayDecimals
    const w = this._estimateBubbleWidthPx(dec, this._min, this._max)
    this._bubbleWidthPx = w
    this._bubble.style.width = `${w}px`
    this._bubble.style.minWidth = `${w}px`
    this._bubble.style.maxWidth = `${w}px`
  }

  _setAria () {
    if (!this._track) return
    this._track.setAttribute('aria-valuemin', String(this._min))
    this._track.setAttribute('aria-valuemax', String(this._max))
    const v = this._valueAtT(this._t)
    this._track.setAttribute('aria-valuenow', String(this._snap(v)))
  }

  _refreshBubbleLabel () {
    if (!this._bubble) return
    const v = this._snap(this._valueAtT(this._t))
    this._bubble.textContent = this._formatDisplayFixed(v)
  }

  /**
   * @param {number} value
   * @param {number} [decimals]
   * @returns {string}
   */
  _formatDisplayFixed (value, decimals = this._displayDecimals) {
    if (!Number.isFinite(value)) return ''
    if (decimals <= 0) return String(Math.round(value))
    return value.toFixed(decimals)
  }

  /**
   * @param {number} step
   * @returns {number}
   */
  _decimalPlacesFromStep (step) {
    if (!Number.isFinite(step) || step <= 0) return 2
    if (Math.abs(step - Math.round(step)) < 1e-9) return 0
    let n = 0
    let x = step
    for (; n < 12; n++) {
      const r = Math.round(x)
      if (Math.abs(x - r) < 1e-7) break
      x *= 10
    }
    return Math.min(n, 8)
  }

  /** @returns {number} */
  _bubbleCharWidthPx () {
    const n = Number(this._bubbleCharWidthOpt)
    return n > 0 ? n : 7.2
  }

  /** @returns {number} */
  _bubbleHorizontalChromePx () {
    return 16
  }

  /**
   * @param {number} decimals
   * @param {number} rangeMin
   * @param {number} rangeMax
   * @returns {number}
   */
  _estimateBubbleWidthPx (decimals, rangeMin, rangeMax) {
    const charW = this._bubbleCharWidthPx()
    const pad = this._bubbleHorizontalChromePx()
    const sMin = this._formatDisplayFixed(rangeMin, decimals)
    const sMax = this._formatDisplayFixed(rangeMax, decimals)
    const len = Math.max(sMin.length, sMax.length)
    return Math.max(28, len * charW + pad)
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
   * @returns {number}
   */
  _snap (value) {
    if (!Number.isFinite(value)) return this._min
    const s = this._step > 0 ? this._step : (this._max - this._min) / 255
    const snapped = this._min + Math.round((value - this._min) / s) * s
    return Math.max(this._min, Math.min(this._max, snapped))
  }
}
