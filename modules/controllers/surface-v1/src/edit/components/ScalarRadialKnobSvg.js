/**
 * Scalar knob: outer arc ring fills clockwise along the path (7 → 12 → 5)
 * with title + value centered. Drag is 1D scrub (↑/→ increase), matching legacy knob behavior.
 */

import {
  evaluate as fnEvaluate,
  inverse as fnInverse
} from '../controls/fnCurve.js'

/** Pixels of combined (↑ + →) pointer travel for normalized t to sweep 0→1. */
const SCRUB_PIXELS_PER_FULL_RANGE = 120

const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_DIST_PX = 40
const TAP_MAX_MOVE_PX = 12
const SCRUB_MOVE_THRESHOLD_PX = 10

/** Scale while the user is dragging (1 = normal). Clamped down if it would leave the viewport. */
export const RADIAL_KNOB_ENGAGED_TARGET_SCALE = 3

/** Minimum inset from window / visualViewport edges when scaled. */
export const RADIAL_KNOB_VIEW_MARGIN_PX = 10

/** Step when reducing scale so the enlarged dial fits on screen. */
export const RADIAL_KNOB_SCALE_SHRINK_STEP = 0.04

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Large arc along outer ring from ~7 o'clock through top to ~5 o'clock (same sweep as legacy needle).
 * Center (50,50), r=38; coordinates rounded for stable dash lengths with pathLength.
 */
const ARC_RING_D = 'M 31 82.909 A 38 38 0 1 1 69 82.909'

/** Normalized path length for stroke-dash math (any positive constant). */
const PATH_LEN_NORM = 1000

/**
 * @typedef {object} ScalarRadialKnobSvgOpts
 * @property {Record<string, unknown>} descriptor
 * @property {string} intentGuid
 * @property {() => unknown} readValue effective domain scalar
 * @property {(domain: number) => void} onCommit
 */

export class ScalarRadialKnobSvg {
  /**
   * @param {ScalarRadialKnobSvgOpts} opts
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
    /** @type {SVGPathElement | null} */
    this._progressPath = null
    /** @type {SVGTextElement | null} */
    this._labelText = null
    /** @type {SVGTextElement | null} */
    this._valueText = null

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
    /** @type {number} latest client X for active drag pointer (post-zoom scrub baseline refresh) */
    this._lastPointerClientX = 0
    /** @type {number} */
    this._lastPointerClientY = 0

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
    this._stepFnName =
      typeof rawFn === 'string' && rawFn.length > 0 ? rawFn : null

    /** @type {(t: number) => number} */
    this._valueAtT =
      this._stepFnName == null
        ? t => this._linearDomainAtT(t)
        : t => this._curveDomainAtT(t)
    /** @type {(v: number) => number} */
    this._tAtValue =
      this._stepFnName == null
        ? v => this._linearTFromDomain(v)
        : v => this._curveTFromDomain(v)

    this._step = this._resolveStep(
      this._descriptor.step,
      this._domainMin,
      this._domainMax
    )

    /** @type {boolean} */
    this._dialEngaged = false
    /** @type {ParentNode | null} original DOM parent before portal */
    this._portalParent = null
    /** @type {ChildNode | null} sibling to reinsert before on disengage */
    this._portalNextSib = null
    /** @type {() => void} */
    this._boundResizeRelayout = () => {
      if (this._dialEngaged) this._ensureEngagedDialOnScreen()
    }
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
    root.className = 'quick-panel-knob quick-panel-knob--svg'
    root.dataset.intentGuid = this._intentGuid
    root.dataset.dotKey = /** @type {string} */ (
      String(this._descriptor.dotKey ?? '')
    )

    const caption = document.createElement('span')
    caption.className = 'quick-panel-knob__caption'
    caption.textContent = /** @type {string} */ (
      this._descriptor.name ?? this._descriptor.dotKey
    )

    const dial = document.createElement('div')
    dial.className = 'quick-panel-knob__dial'
    dial.setAttribute('role', 'slider')
    dial.setAttribute('aria-valuemin', String(this._domainMin))
    dial.setAttribute('aria-valuemax', String(this._domainMax))
    dial.tabIndex = 0

    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', '0 0 100 100')
    svg.setAttribute('class', 'quick-panel-knob-svg')
    svg.setAttribute('aria-hidden', 'true')

    const face = document.createElementNS(SVG_NS, 'circle')
    face.setAttribute('class', 'quick-panel-knob-svg__face')
    face.setAttribute('cx', '50')
    face.setAttribute('cy', '50')
    face.setAttribute('r', '44')

    const track = document.createElementNS(SVG_NS, 'path')
    track.setAttribute('class', 'quick-panel-knob-svg__track')
    track.setAttribute('d', ARC_RING_D)
    track.setAttribute('fill', 'none')
    track.setAttribute('pathLength', String(PATH_LEN_NORM))

    const progress = document.createElementNS(SVG_NS, 'path')
    progress.setAttribute('class', 'quick-panel-knob-svg__progress')
    progress.setAttribute('d', ARC_RING_D)
    progress.setAttribute('fill', 'none')
    progress.setAttribute('pathLength', String(PATH_LEN_NORM))

    const centerG = document.createElementNS(SVG_NS, 'g')
    centerG.setAttribute('class', 'quick-panel-knob-svg__center')
    centerG.setAttribute('transform', 'translate(50 51)')

    const labelText = document.createElementNS(SVG_NS, 'text')
    labelText.setAttribute('class', 'quick-panel-knob-svg__label')
    labelText.setAttribute('x', '0')
    labelText.setAttribute('y', '-10')
    labelText.setAttribute('text-anchor', 'middle')
    labelText.textContent = /** @type {string} */ (
      this._descriptor.name ?? this._descriptor.dotKey ?? ''
    )

    const valueText = document.createElementNS(SVG_NS, 'text')
    valueText.setAttribute('class', 'quick-panel-knob-svg__value')
    valueText.setAttribute('x', '0')
    valueText.setAttribute('y', '12')
    valueText.setAttribute('text-anchor', 'middle')
    valueText.textContent = '0'

    centerG.appendChild(labelText)
    centerG.appendChild(valueText)

    svg.appendChild(face)
    svg.appendChild(track)
    svg.appendChild(progress)
    svg.appendChild(centerG)

    dial.appendChild(svg)

    root.appendChild(caption)
    root.appendChild(dial)

    this._root = root
    this._dial = dial
    this._progressPath = progress
    this._labelText = labelText
    this._valueText = valueText

    dial.addEventListener('pointerdown', e => this._onPointerDown(e), {
      signal
    })
    dial.addEventListener('pointermove', e => this._onPointerMove(e), {
      signal
    })
    dial.addEventListener('pointerup', e => this._onPointerUp(e), { signal })
    dial.addEventListener('pointercancel', e => this._onPointerCancel(e), {
      signal
    })

    dial.addEventListener(
      'lostpointercapture',
      e => this._onLostPointerCapture(e),
      { signal }
    )

    this.syncFromExternal()
    parent.appendChild(root)
    return root
  }

  /** Re-read authoritative value into visuals (e.g. after graph reconcile). */
  syncFromExternal () {
    if (this._dragPointerId !== null) return
    const v = Number(this._readValue())
    const safe = Number.isFinite(v) ? v : this._domainMin
    let t = this._tAtValue(safe)
    if (!Number.isFinite(t)) t = 0
    this._t = Math.max(0, Math.min(1, t))
    this._syncVisualDomain(this._valueAtT(this._t))
  }

  destroy () {
    this._setDialEngaged(false)
    this._abort?.abort()
    this._abort = null
    // If still portalled (e.g. destroyed mid-drag), remove from body.
    if (
      this._root &&
      this._root.parentNode === document.body &&
      !this._portalParent
    ) {
      this._root.remove()
    }
    this._root = null
    this._dial = null
    this._progressPath = null
    this._labelText = null
    this._valueText = null
  }

  /**
   * @param {boolean} engaged
   */
  _setDialEngaged (engaged) {
    if (engaged === this._dialEngaged) return
    const root = this._root
    if (!engaged) {
      this._dialEngaged = false
      window.removeEventListener('resize', this._boundResizeRelayout)
      const vvOff = window.visualViewport
      if (vvOff) {
        vvOff.removeEventListener('resize', this._boundResizeRelayout)
        vvOff.removeEventListener('scroll', this._boundResizeRelayout)
      }
      if (root) {
        root.classList.remove('quick-panel-knob--engaged')
        root.style.position = ''
        root.style.top = ''
        root.style.left = ''
        root.style.transformOrigin = ''
        root.style.zIndex = ''
        root.style.transform = ''
        if (this._portalParent) {
          this._portalParent.insertBefore(root, this._portalNextSib)
          this._portalParent = null
          this._portalNextSib = null
        }
      }
      return
    }
    if (!root || !this._dial) return
    // Capture viewport-relative position before moving to portal.
    const rect = root.getBoundingClientRect()
    this._dialEngaged = true
    // Record DOM location so we can reattach on disengage.
    this._portalParent = root.parentNode
    this._portalNextSib = root.nextSibling
    // Move to body — escapes any ancestor overflow:hidden or transform offset.
    document.body.appendChild(root)
    root.classList.add('quick-panel-knob--engaged')
    root.style.position = 'fixed'
    root.style.top = `${rect.top}px`
    root.style.left = `${rect.left}px`
    root.style.transformOrigin = 'top left'
    root.style.zIndex = '9999'
    window.addEventListener('resize', this._boundResizeRelayout)
    const vvOn = window.visualViewport
    if (vvOn) {
      vvOn.addEventListener('resize', this._boundResizeRelayout)
      vvOn.addEventListener('scroll', this._boundResizeRelayout)
    }
    this._ensureEngagedDialOnScreen()
  }

  /**
   * Fits the fixed-positioned knob inside the visual viewport.
   * With position:fixed + transform-origin:top left, top/left drive placement
   * and scale(s) drives size — no iterative getBoundingClientRect loop needed.
   */
  _ensureEngagedDialOnScreen () {
    if (!this._dialEngaged || !this._root) return
    const root = this._root
    const m = RADIAL_KNOB_VIEW_MARGIN_PX
    const vv = window.visualViewport
    const vw = vv?.width ?? window.innerWidth
    const vh = vv?.height ?? window.innerHeight
    const vx = vv?.offsetLeft ?? 0
    const vy = vv?.offsetTop ?? 0
    const leftBound = vx + m
    const topBound = vy + m
    const rightBound = vx + vw - m
    const bottomBound = vy + vh - m

    const naturalW = root.offsetWidth
    const naturalH = root.offsetHeight

    let s = RADIAL_KNOB_ENGAGED_TARGET_SCALE
    while (
      s > 1.02 &&
      (naturalW * s > rightBound - leftBound ||
        naturalH * s > bottomBound - topBound)
    ) {
      s -= RADIAL_KNOB_SCALE_SHRINK_STEP
    }

    const scaledW = naturalW * s
    const scaledH = naturalH * s
    let top = parseFloat(root.style.top) || 0
    let left = parseFloat(root.style.left) || 0

    if (left + scaledW > rightBound) left = rightBound - scaledW
    if (top + scaledH > bottomBound) top = bottomBound - scaledH
    if (left < leftBound) left = leftBound
    if (top < topBound) top = topBound

    root.style.top = `${top}px`
    root.style.left = `${left}px`
    root.style.transform = `scale(${s})`

    if (this._dragPointerId !== null) {
      this._dragStartClientX = this._lastPointerClientX
      this._dragStartClientY = this._lastPointerClientY
    }
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
    if (
      explicit !== undefined &&
      explicit !== null &&
      Number.isFinite(Number(explicit))
    ) {
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
   * @param {number} domain
   */
  _syncVisualDomain (domain) {
    const v = this._snap(domain)
    const prog = this._progressPath
    if (prog) {
      const pl = PATH_LEN_NORM
      const u = Math.max(0, Math.min(1, this._t))
      const vis = pl * u
      prog.style.strokeDasharray = `${vis} ${pl}`
      prog.style.strokeDashoffset = '0'
    }
    if (this._valueText) {
      const dec = Math.min(8, Math.max(0, this._decimalsFromStep()))
      this._valueText.textContent =
        dec <= 0 ? String(Math.round(v)) : v.toFixed(Math.min(dec, 4))
    }
    if (this._dial) {
      this._dial.setAttribute('aria-valuenow', String(v))
      this._dial.setAttribute(
        'aria-label',
        /** @type {string} */ (
          this._descriptor.name ?? this._descriptor.dotKey ?? 'value'
        )
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
      if (
        elapsed < DOUBLE_TAP_MS &&
        dist < DOUBLE_TAP_DIST_PX &&
        this._applyDefaultDomain()
      ) {
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
    this._lastPointerClientX = e.clientX
    this._lastPointerClientY = e.clientY
    this._dragStartT = this._t
    this._setDialEngaged(true)
    this._dial.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  /** @param {PointerEvent} e */
  _onPointerMove (e) {
    if (!this._dial || this._dragPointerId !== e.pointerId) return
    this._lastPointerClientX = e.clientX
    this._lastPointerClientY = e.clientY
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
    this._dragPointerId = null
    try {
      this._dial.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    this._setDialEngaged(false)
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
    this._dragPointerId = null
    try {
      this._dial.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    this._setDialEngaged(false)
    this._lastTap = null
    e.preventDefault()
  }

  /**
   * iOS can drop pointerup while capture is held; disengage so the portalled HUD never sticks.
   * @param {PointerEvent} e
   */
  _onLostPointerCapture (e) {
    if (!this._dial || this._dragPointerId !== e.pointerId) return
    this._dragPointerId = null
    this._setDialEngaged(false)
    this._lastTap = null
  }

  /**
   * Snap descriptor.defaultValue to domain, update t and ring, commit.
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
