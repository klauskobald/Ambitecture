/**
 * Perform quick-panel scalar control: needle moves clockwise along the dial arc
 * t=0 at 7 o’clock, t=0.5 at 12, t=1 at 5 (CSS rotate from 12 = 0°). Drag is a 1D scrub
 * (↑/→ increase, ↓/← decrease), not angular finger position on the dial.
 */

import { evaluate as fnEvaluate, inverse as fnInverse } from '../edit/controls/fnCurve.js'

/** Pixels of combined (↑ + →) pointer travel for normalized t to sweep 0→1. */
const SCRUB_PIXELS_PER_FULL_RANGE = 120

const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_DIST_PX = 40
const TAP_MAX_MOVE_PX = 12
const SCRUB_MOVE_THRESHOLD_PX = 10

/** Clock positions as clockwise degrees from 12 o’clock (rotate(0) = needle at top). */
const DEG_7_OCLOCK = 210
const DEG_5_OCLOCK = 150

/**
 * @typedef {object} ScalarRadialKnobOpts
 * @property {Record<string, unknown>} descriptor
 * @property {string} intentGuid
 * @property {() => unknown} readValue effective domain scalar
 * @property {(domain: number) => void} onCommit
 */

export class ScalarRadialKnob {
  /**
   * @param {ScalarRadialKnobOpts} opts
   */
  constructor (opts) {
    this._descriptor = opts.descriptor
    this._intentGuid = opts.intentGuid
    this._readValue = opts.readValue
    this._onCommit = opts.onCommit

    /** @type {AbortController | null} */
    this._abort = null
    /** @type {HTMLElement | null} */
    this._root = null
    /** @type {HTMLElement | null} */
    this._dial = null
    /** @type {HTMLElement | null} */
    this._needle = null
    /** @type {HTMLElement | null} */
    this._label = null
    /** @type {HTMLElement | null} */
    this._valueEl = null

    /** @type {number} normalized t ∈ [0,1] mapped through stepFunction then range */
    this._t = 0

    /** @type {number | null} pointer id dragging this knob */
    this._dragPointerId = null
    /** @type {number} */
    this._dragStartClientX = 0
    /** @type {number} */
    this._dragStartClientY = 0
    /** t at pointer-down (scrub baseline) */
    this._dragStartT = 0

    /** @type {{ clientX: number, clientY: number, t: number } | null} */
    this._lastTap = null
    /** @type {number} */
    this._downClientX = 0
    /** @type {number} */
    this._downClientY = 0
    /** @type {boolean} */
    this._scrubMoved = false

    const range = /** @type {number[] | undefined} */ (this._descriptor.range)
    this._domainMin = range?.[0] ?? 0
    this._domainMax = range?.[1] ?? 1
    this._span = this._domainMax - this._domainMin

    const rawFn = this._descriptor.stepFunction
    this._stepFnName = typeof rawFn === 'string' && rawFn.length > 0 ? rawFn : null

    /** @type {(t: number) => number} */
    this._valueAtT =
      this._stepFnName == null
        ? (t) => this._linearDomainAtT(t)
        : (t) => this._curveDomainAtT(t)
    /** @type {(v: number) => number} */
    this._tAtValue =
      this._stepFnName == null
        ? (v) => this._linearTFromDomain(v)
        : (v) => this._curveTFromDomain(v)

    this._step = this._resolveStep(
      this._descriptor.step,
      this._domainMin,
      this._domainMax
    )
  }

  /**
   * @param {HTMLElement} parent
   * @returns {HTMLElement}
   */
  mount (parent) {
    this.destroy()
    this._abort = new AbortController()
    const signal = this._abort.signal

    const root = document.createElement('div')
    root.className = 'quick-panel-knob'
    root.dataset.intentGuid = this._intentGuid
    root.dataset.dotKey = /** @type {string} */ (String(this._descriptor.dotKey ?? ''))

    const label = document.createElement('span')
    label.className = 'quick-panel-knob__caption'
    label.textContent = /** @type {string} */ (this._descriptor.name ?? this._descriptor.dotKey)

    const dial = document.createElement('div')
    dial.className = 'quick-panel-knob__dial'
    dial.setAttribute('role', 'slider')
    dial.setAttribute(
      'aria-valuemin',
      String(this._domainMin)
    )
    dial.setAttribute(
      'aria-valuemax',
      String(this._domainMax)
    )
    dial.tabIndex = 0

    const needle = document.createElement('div')
    needle.className = 'quick-panel-knob__needle'
    needle.setAttribute('aria-hidden', 'true')

    const bub = document.createElement('span')
    bub.className = 'quick-panel-knob__value'

    dial.appendChild(needle)
    dial.appendChild(bub)

    root.appendChild(label)
    root.appendChild(dial)

    this._root = root
    this._dial = dial
    this._needle = needle
    this._label = label
    this._valueEl = bub

    dial.addEventListener('pointerdown', e => this._onPointerDown(e), {
      signal
    })
    dial.addEventListener('pointermove', e => this._onPointerMove(e), {
      signal
    })
    dial.addEventListener('pointerup', e => this._onPointerUp(e), { signal })
    dial.addEventListener('pointercancel', e => this._onPointerCancel(e), { signal })

    this.syncFromExternal()
    parent.appendChild(root)
    return root
  }

  /** Re-read authoritative value into rotation (e.g. after graph reconcile). */
  syncFromExternal () {
    if (this._dragPointerId !== null) return
    const v = Number(this._readValue())
    const safe = Number.isFinite(v)
      ? v
      : this._domainMin
    let t = this._tAtValue(safe)
    if (!Number.isFinite(t)) t = 0
    this._t = Math.max(0, Math.min(1, t))
    this._syncVisualDomain(this._valueAtT(this._t))
  }

  destroy () {
    this._abort?.abort()
    this._abort = null
    this._root = null
    this._dial = null
    this._needle = null
    this._label = null
    this._valueEl = null
  }

  // ── Geometry / mapping ────────────────────────────────────────────────────

  /**
   * @param {number} t normalized [0,1]
   * @returns {number}
   */
  _linearDomainAtT (t) {
    if (this._span <= 0) return this._domainMin
    const raw = this._domainMin + t * this._span
    return this._snap(raw)
  }

  /**
   * @param {number} v
   * @returns {number} t ∈ [0,1]
   */
  _linearTFromDomain (v) {
    if (this._span <= 0) return 0
    const snapped = this._snap(v)
    return (snapped - this._domainMin) / this._span
  }

  /**
   * @param {number} t normalized [0,1]
   * @returns {number}
   */
  _curveDomainAtT (t) {
    const name = /** @type {string} */ (this._stepFnName)
    const u = fnEvaluate(name, t)
    const raw = this._domainMin + this._span * u
    return this._snap(raw)
  }

  /**
   * @param {number} v
   * @returns {number}
   */
  _curveTFromDomain (v) {
    if (this._span <= 0) return 0
    const name = /** @type {string} */ (this._stepFnName)
    const snapped = this._snap(v)
    const u = (snapped - this._domainMin) / this._span
    return Math.max(0, Math.min(1, fnInverse(name, u)))
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
    if (!Number.isFinite(value)) return this._domainMin
    const min = this._domainMin
    const max = this._domainMax
    const step = this._step > 0 ? this._step : (max - min) / 255
    const snapped = min + Math.round((value - min) / step) * step
    return Math.max(min, Math.min(max, snapped))
  }

  /**
   * Needle at rotate(0deg) points to 12 (top). Clockwise from 12: 7h = 210°, 5h = 150°.
   * t=0 → 7 o’clock, t=0.5 → 12, t=1 → 5, linear in t along each half of the arc.
   * @param {number} t normalized [0,1]
   * @returns {number}
   */
  _needleRotateDegFromT (t) {
    const u = Math.max(0, Math.min(1, t))
    if (u <= 0.5) {
      const s = u / 0.5
      return DEG_7_OCLOCK + (360 - DEG_7_OCLOCK) * s
    }
    const s = (u - 0.5) / 0.5
    return DEG_5_OCLOCK * s
  }

  /**
   * @param {number} domain
   */
  _syncVisualDomain (domain) {
    const v = this._snap(domain)
    if (this._needle && this._dial) {
      const deg = this._needleRotateDegFromT(this._t)
      this._needle.style.transform = `translate(-50%, -100%) rotate(${deg}deg)`
    }
    if (this._valueEl) {
      const dec = Math.min(8, Math.max(0, this._decimalsFromStep()))
      this._valueEl.textContent =
        dec <= 0 ? String(Math.round(v)) : v.toFixed(Math.min(dec, 4))
    }
    if (this._dial) {
      this._dial.setAttribute('aria-valuenow', String(v))
      this._dial.setAttribute(
        'aria-label',
        /** @type {string} */ (this._descriptor.name ?? this._descriptor.dotKey ?? 'value')
      )
    }
  }

  /**
   * @returns {number}
   */
  _decimalsFromStep () {
    const step = this._step
    if (!Number.isFinite(step) || step <= 0) return 2
    if (Math.abs(step - Math.round(step)) < 1e-9) return 0
    let n = 0
    let x = step
    for (; n < 12; n++) {
      const r = Math.round(x)
      if (Math.abs(x - r) < 1e-7) break
      x *= 10
    }
    return Math.min(n, 4)
  }

  /** @param {PointerEvent} e */
  _onPointerDown (e) {
    if (!this._dial) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (this._dragPointerId !== null) return

    if (this._lastTap) {
      const elapsed = performance.now() - this._lastTap.t
      const dist = Math.hypot(
        e.clientX - this._lastTap.clientX,
        e.clientY - this._lastTap.clientY
      )
      if (elapsed < DOUBLE_TAP_MS && dist < DOUBLE_TAP_DIST_PX && this._applyDefaultDomain()) {
        this._lastTap = null
        e.preventDefault()
        return
      }
      this._lastTap = null
    }

    this._downClientX = e.clientX
    this._downClientY = e.clientY
    this._scrubMoved = false
    this._dragPointerId = e.pointerId
    this._dragStartClientX = e.clientX
    this._dragStartClientY = e.clientY
    this._dragStartT = this._t
    this._dial.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  /** @param {PointerEvent} e */
  _onPointerMove (e) {
    if (!this._dial || this._dragPointerId !== e.pointerId) return
    const slide = SCRUB_PIXELS_PER_FULL_RANGE
    if (slide <= 0) return
    const dx = e.clientX - this._dragStartClientX
    const dy = e.clientY - this._dragStartClientY
    const increase = dx - dy
    if (Math.abs(increase) > SCRUB_MOVE_THRESHOLD_PX) this._scrubMoved = true
    let nt = this._dragStartT + increase / slide
    nt = Math.max(0, Math.min(1, nt))
    this._t = nt
    let domain = this._valueAtT(this._t)
    domain = this._snap(domain)
    this._t = this._tAtValue(domain)
    this._syncVisualDomain(domain)
    this._onCommit(domain)
    e.preventDefault()
  }

  /** @param {PointerEvent} e */
  _onPointerUp (e) {
    if (!this._dial || this._dragPointerId !== e.pointerId) return
    try {
      this._dial.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    this._dragPointerId = null
    const tapDist = Math.hypot(
      e.clientX - this._downClientX,
      e.clientY - this._downClientY
    )
    if (!this._scrubMoved && tapDist < TAP_MAX_MOVE_PX) {
      this._lastTap = {
        clientX: this._downClientX,
        clientY: this._downClientY,
        t: performance.now()
      }
    } else {
      this._lastTap = null
    }
    e.preventDefault()
  }

  /** @param {PointerEvent} e */
  _onPointerCancel (e) {
    if (!this._dial || this._dragPointerId !== e.pointerId) return
    try {
      this._dial.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    this._dragPointerId = null
    this._lastTap = null
    e.preventDefault()
  }

  /**
   * Snap descriptor.defaultValue to domain, update t and needle, commit.
   * @returns {boolean} true if a default was applied
   */
  _applyDefaultDomain () {
    const raw = this._descriptor.defaultValue
    if (raw === undefined || raw === null) return false
    const num = Number(raw)
    if (!Number.isFinite(num)) return false
    let domain = this._snap(num)
    let t = this._tAtValue(domain)
    if (!Number.isFinite(t)) t = 0
    this._t = Math.max(0, Math.min(1, t))
    domain = this._snap(this._valueAtT(this._t))
    this._t = this._tAtValue(domain)
    this._t = Math.max(0, Math.min(1, this._t))
    this._syncVisualDomain(domain)
    this._onCommit(domain)
    return true
  }
}
