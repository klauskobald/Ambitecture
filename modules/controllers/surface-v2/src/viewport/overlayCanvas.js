import { intentLayer, intentName, intentRadius } from '../core/stores.js'
import { projectGraph } from '../core/projectGraph.js'
import {
  worldToCanvas,
  clientToWorldViaSimCanvas,
  isPositionInsideAnyZone,
  overlayClientToBboxMeters
} from './spatialMath.js'
import { noopPolicy } from './interactionPolicies.js'
import { isIntentLocked } from '../core/intentLockRegistry.js'

/**
 * @typedef {import('../core/projectGraph.js').HubSpatialState} HubSpatialState
 * @typedef {import('./interactionPolicies.js').InteractionPolicy} InteractionPolicy
 * @typedef {import('./selectionManager.js').SelectionManager<unknown>} AnySelectionManager
 */

const DRAG_HIT_RADIUS_PX = 28

/**
 * Resolve every intent guid to its effective intent and return them sorted by
 * `layer` ascending (NaN/missing → 0). Higher-layer intents end up last so
 * canvas painting order naturally stacks them on top.
 *
 * @param {Map<string, unknown>} intents
 * @returns {{ guid: string, intent: Record<string, unknown> }[]}
 */
function sortedByLayerAsc (intents) {
  /** @type {{ guid: string, intent: Record<string, unknown>, layer: number }[]} */
  const rows = []
  for (const [guid, sharedIntent] of intents) {
    const intent = projectGraph.getEffectiveIntent(guid) ?? sharedIntent
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) continue
    const layerNum = intentLayer(intent)
    rows.push({
      guid,
      intent: /** @type {Record<string, unknown>} */ (intent),
      layer: Number.isFinite(layerNum) ? layerNum : 0
    })
  }
  rows.sort((a, b) => a.layer - b.layer)
  return rows.map(r => ({ guid: r.guid, intent: r.intent }))
}

export class OverlayCanvas {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} stack  the sim-stack container (used for resize observation)
   * @param {import('./simulatorViewport.js').SimulatorViewport} viewport
   * @param {import('../app/config.js').LayoutConfig} layoutConfig
   */
  constructor (canvas, stack, viewport, layoutConfig) {
    this._canvas = canvas
    this._stack = stack
    this._viewport = viewport
    this._L = layoutConfig
    /** @type {InteractionPolicy} */
    this._policy = noopPolicy
    /** @type {AnySelectionManager | null} */
    this._selectionManager = null

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable.')
    this._ctx = ctx

    /** @type {{ x: number, y: number, t: number }[]} */
    this._samples = []
    /** @type {Set<number>} */
    this._activePointers = new Set()
    /** @type {Map<number, string>} pointerId → intent guid */
    this._draggedIntents = new Map()
    /** @type {Map<number, string>} pointerId → target intent guid (height slider drag) */
    this._draggedHeightSliders = new Map()
    /** @type {Map<number, string>} pointerId → fixture id */
    this._draggedFixtures = new Map()
    /** @type {Map<number, string>} pointerId → fixture id (height slider drag) */
    this._draggedFixtureHeightSliders = new Map()
    /** @type {((guid: string) => void) | null} */
    this._doubleTapIntentCallback = null
    /** @type {((guid: string) => void) | null} */
    this._singleTapIntentCallback = null
    /** @type {((detail: { clientX: number, clientY: number }) => void) | null} */
    this._doubleTapEmptyCallback = null
    /** @type {{ pointerId: number, downX: number, downY: number, downClientX: number, downClientY: number, intentGuid: string | null } | null} */
    this._tapTracker = null
    /** @type {{ x: number, y: number, t: number, clientX: number, clientY: number, intentGuid: string | null } | null} */
    this._lastTap = null

    /** @type {number | null} */
    this._rafId = null
    this._lastRenderActivityMs = 0
    this._inactivityStopMs = 10
    /** @type {(() => void) | null} */
    this._coactivity = null

    this._bindPointerEvents()
    this._ro = new ResizeObserver(() => this.resize())
    this._ro.observe(stack)
    this.resize()
    this.markRenderActivity()
  }

  /**
   * Optional hook invoked whenever overlay redraw is requested (hub, pointer, resize).
   * @param {(() => void) | null} fn
   */
  setCoactivityCallback (fn) {
    this._coactivity = fn
  }

  /** Extends the animated redraw window (see `_inactivityStopMs`) and ensures one rAF chain is scheduled. */
  markRenderActivity () {
    this._lastRenderActivityMs = performance.now()
    if (this._rafId === null) {
      this._rafId = requestAnimationFrame(() => this._runFrame())
    }
    this._coactivity?.()
  }

  /** @returns {void} */
  _runFrame () {
    this._rafId = null
    const now = performance.now()
    const L = this._L
    const fadeMs = L.overlayTrailFadeMs
    while (this._samples.length > 0 && now - this._samples[0].t > fadeMs)
      this._samples.shift()

    const rect = this._canvas.getBoundingClientRect()
    const ctx = this._ctx
    ctx.clearRect(0, 0, rect.width, rect.height)

    // touch trail
    const r = L.overlayFingerRadiusPx
    ctx.lineWidth = L.overlayLineWidthPx
    ctx.strokeStyle = L.overlayFingerStrokeRgba
    ctx.fillStyle = L.overlayFingerFillRgba
    for (const s of this._samples) {
      const a = 1 - (now - s.t) / fadeMs
      if (a <= 0) continue
      ctx.globalAlpha = Math.min(1, Math.max(0, a))
      ctx.beginPath()
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    const spatial = projectGraph.getSpatial()
    const simRect = this._viewport.getSimCanvasRect()
    if (spatial && simRect) {
      // dragged intent highlights
      if (this._draggedIntents.size > 0) {
        for (const guid of this._draggedIntents.values()) {
          if (isIntentLocked(guid)) continue
          const intent =
            projectGraph.getEffectiveIntent(guid) ??
            projectGraph.getIntents().get(guid)
          if (!intent) continue
          const i = /** @type {Record<string, unknown>} */ (intent)
          const pos = /** @type {number[] | undefined} */ (i.position)
          if (!pos) continue
          const { px, py } = worldToCanvas(
            pos[0],
            pos[2],
            spatial,
            simRect,
            rect
          )
          ctx.save()
          ctx.beginPath()
          ctx.arc(px, py, L.overlayFingerRadiusPx * 1.4, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(255, 220, 80, 0.9)'
          ctx.lineWidth = 2
          ctx.stroke()
          ctx.fillStyle = 'rgba(255, 220, 80, 0.25)'
          ctx.fill()
          ctx.restore()
        }
      }

      // dragged fixture highlights
      if (this._draggedFixtures.size > 0) {
        for (const id of this._draggedFixtures.values()) {
          const fixture = projectGraph.getFixtures().get(id)
          if (!fixture) continue
          const f = /** @type {Record<string, unknown>} */ (fixture)
          const pos = /** @type {number[] | undefined} */ (f.position)
          if (!pos) continue
          const { px, py } = worldToCanvas(
            pos[0],
            pos[2],
            spatial,
            simRect,
            rect
          )
          ctx.save()
          ctx.strokeStyle = 'rgba(80, 220, 255, 0.95)'
          ctx.lineWidth = 2
          ctx.strokeRect(px - 10, py - 10, 20, 20)
          ctx.restore()
        }
      }

      // intent radius circles — paint lower layers first so higher layers stack on top
      const sortedIntents = sortedByLayerAsc(projectGraph.getIntents())
      for (const { guid, intent } of sortedIntents) {
        if (isIntentLocked(guid)) continue
        if (!this._policy.isIntentVisible(intent)) continue
        const i = /** @type {Record<string, unknown>} */ (intent)
        const pos = /** @type {number[] | undefined} */ (i.position)
        const radius = intentRadius(intent)
        if (!pos || pos.length < 3 || radius <= 0) continue
        const center = worldToCanvas(pos[0], pos[2], spatial, simRect, rect)
        const edge = worldToCanvas(
          pos[0] + radius,
          pos[2],
          spatial,
          simRect,
          rect
        )
        const radiusPx = Math.abs(edge.px - center.px)
        if (!Number.isFinite(radiusPx) || radiusPx <= 0) continue
        ctx.save()
        ctx.beginPath()
        ctx.arc(center.px, center.py, radiusPx, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(128, 128, 128, 0.02)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(128, 128, 128, 0.1)'
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.restore()
      }

      // out-of-zone intent markers — same layer ordering as the radius circles above
      const zoneBoxes = projectGraph.getZoneBoxes()
      for (const { guid, intent } of sortedIntents) {
        if (isIntentLocked(guid)) continue
        if (!this._policy.isIntentVisible(intent)) continue
        const i = /** @type {Record<string, unknown>} */ (intent)
        const pos = /** @type {number[] | undefined} */ (i.position)
        if (!pos || pos.length < 3) continue
        if (isPositionInsideAnyZone(pos, zoneBoxes)) continue
        const { px, py } = worldToCanvas(pos[0], pos[2], spatial, simRect, rect)
        const size = 12
        ctx.save()
        ctx.fillStyle = 'rgba(120, 120, 120, 0.5)'
        ctx.strokeStyle = 'rgba(170, 170, 170, 0.8)'
        ctx.lineWidth = 1
        ctx.fillRect(px - size / 2, py - size / 2, size, size)
        ctx.strokeRect(px - size / 2, py - size / 2, size, size)
        const name = intentName(intent)
        if (name) {
          ctx.fillStyle = 'rgba(170, 170, 170, 0.95)'
          ctx.font = '11px monospace'
          ctx.textAlign = 'center'
          ctx.fillText(name, px, py + size / 2 + 12)
        }
        ctx.restore()
      }

      // height sliders for target intents — visualise/edit position[1] (height in metres)
      const yRange = spatial.y2 - spatial.y1
      if (yRange > 0) {
        const engagedGuids = new Set(this._draggedHeightSliders.values())
        for (const { guid, intent } of sortedIntents) {
          if (isIntentLocked(guid)) continue
          const i = /** @type {Record<string, unknown>} */ (intent)
          if (i.class !== 'target') continue
          if (!this._policy.isIntentVisible(intent)) continue
          const pos = /** @type {number[] | undefined} */ (i.position)
          if (!pos || pos.length < 3) continue
          const { px, py } = worldToCanvas(pos[0], pos[2], spatial, simRect, rect)
          const height = Number(pos[1])
          const t = Math.min(1, Math.max(0, (height - spatial.y1) / yRange))
          this._drawHeightSlider(ctx, px, py, t, height, engagedGuids.has(guid))
        }
      }

      // fixtures: a height slider while fixture editing is unlocked (no shadow), otherwise a
      // small metres label beneath the fixture so perform/locked views still read its height.
      if (yRange > 0) {
        const engagedFixtures = new Set(this._draggedFixtureHeightSliders.values())
        for (const [id, fixture] of projectGraph.getFixtures()) {
          const f = /** @type {Record<string, unknown>} */ (fixture)
          const pos = /** @type {number[] | undefined} */ (f.position)
          if (!pos || pos.length < 3) continue
          const { px, py } = worldToCanvas(pos[0], pos[2], spatial, simRect, rect)
          const height = Number(pos[1])
          if (this._policy.canDragFixture(fixture)) {
            const t = Math.min(1, Math.max(0, (height - spatial.y1) / yRange))
            this._drawHeightSlider(ctx, px, py, t, height, engagedFixtures.has(id))
          } else {
            this._drawFixtureHeightLabel(ctx, px, py, height)
          }
        }
      }

      // selection manager bubbles — drawn last so they appear on top
      if (this._selectionManager) {
        this._selectionManager.draw(ctx, spatial, simRect, rect)
      }
    }

    const idleMs = performance.now() - this._lastRenderActivityMs
    const dragOrTrail =
      this._samples.length > 0 ||
      this._draggedIntents.size > 0 ||
      this._draggedHeightSliders.size > 0 ||
      this._draggedFixtures.size > 0 ||
      this._draggedFixtureHeightSliders.size > 0
    if (idleMs < this._inactivityStopMs || dragOrTrail) {
      this._rafId = requestAnimationFrame(() => this._runFrame())
    }
  }

  /** @param {InteractionPolicy} policy */
  setPolicy (policy) {
    this._policy = policy
  }

  /**
   * When a SelectionManager is active it takes full control of pointer events
   * (no dragging) and draws its bubbles on top of the normal canvas content.
   * Pass null to deactivate.
   * @param {AnySelectionManager | null} manager
   */
  setSelectionManager (manager) {
    this._selectionManager = manager
  }

  /**
   * @param {((guid: string) => void) | null} fn
   */
  setDoubleTapIntentCallback (fn) {
    this._doubleTapIntentCallback = fn
    this._lastTap = null
    this._tapTracker = null
  }

  /**
   * Single-tap (no drag) on an intent marker. Fires on pointer-up.
   * @param {((guid: string) => void) | null} fn
   */
  setSingleTapIntentCallback (fn) {
    this._singleTapIntentCallback = fn
  }

  /**
   * Second tap on empty canvas (no intent under first tap), same time/distance window as intent double-tap.
   * @param {((detail: { clientX: number, clientY: number }) => void) | null} fn
   */
  setDoubleTapEmptyCallback (fn) {
    this._doubleTapEmptyCallback = fn
    this._lastTap = null
    this._tapTracker = null
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{ wx: number, wy: number, wz: number } | null}
   */
  worldFromClient (clientX, clientY) {
    const spatial = projectGraph.getSpatial()
    const simRect = this._viewport.getSimCanvasRect()
    if (!spatial || !simRect) return null
    const m = clientToWorldViaSimCanvas(clientX, clientY, spatial, simRect)
    if (!m) return null
    return { wx: m.wx, wy: spatial.y1, wz: m.wz }
  }

  resize () {
    const rect = this._stack.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.floor(rect.width * dpr))
    const h = Math.max(1, Math.floor(rect.height * dpr))
    this._canvas.width = w
    this._canvas.height = h
    this._canvas.style.width = `${rect.width}px`
    this._canvas.style.height = `${rect.height}px`
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.markRenderActivity()
  }

  /**
   * Overlay canvas plus simulator iframe viewport — use with {@link worldToCanvas}
   * to position HUD elements in screen space matching intent markers.
   * @returns {{ canvas: HTMLCanvasElement, viewport: import('./simulatorViewport.js').SimulatorViewport }}
   */
  getHudPositioningContext () {
    return { canvas: this._canvas, viewport: this._viewport }
  }

  _bindPointerEvents () {
    this._canvas.addEventListener('pointerdown', ev => this._onPointerDown(ev))
    this._canvas.addEventListener('pointermove', ev => this._onPointerMove(ev))
    this._canvas.addEventListener('pointerup', ev => this._onPointerUp(ev))
    this._canvas.addEventListener('pointercancel', ev => this._onPointerUp(ev))
  }

  /** @param {PointerEvent} ev */
  _onPointerDown (ev) {
    if (ev.button !== undefined && ev.button !== 0) return
    this.markRenderActivity()
    const { x, y } = this._canvasPoint(ev)
    const spatial = projectGraph.getSpatial()

    // Selection mode: route taps to the manager, block all drag interaction
    if (this._selectionManager) {
      const simRect = this._viewport.getSimCanvasRect()
      if (spatial && simRect) {
        this._selectionManager.handleTap(
          x,
          y,
          spatial,
          simRect,
          this._canvas.getBoundingClientRect()
        )
      }
      return
    }

    // Height slider grab takes priority over cross dragging (it sits beside the marker).
    if (spatial) {
      const sliderGuid = this._findHeightSliderAt(x, y, spatial)
      if (sliderGuid !== null) {
        this._draggedHeightSliders.set(ev.pointerId, sliderGuid)
        this._capture(ev)
        return
      }
      const sliderFixtureId = this._findFixtureHeightSliderAt(x, y, spatial)
      if (sliderFixtureId !== null) {
        this._draggedFixtureHeightSliders.set(ev.pointerId, sliderFixtureId)
        this._capture(ev)
        return
      }
    }

    // Double-tap detection: second tap close to first within 300ms (intent edit or empty-canvas create)
    if (this._lastTap) {
      const elapsed = performance.now() - this._lastTap.t
      const dist = Math.hypot(x - this._lastTap.x, y - this._lastTap.y)
      if (elapsed < 300 && dist < 40) {
        if (this._lastTap.intentGuid && this._doubleTapIntentCallback) {
          const guid = this._lastTap.intentGuid
          this._lastTap = null
          if (!isIntentLocked(guid)) this._doubleTapIntentCallback(guid)
          return
        }
        const secondOnIntent = spatial
          ? this._findIntentAt(x, y, spatial, intent => this._policy.isIntentVisible(intent))
          : null
        if (
          !this._lastTap.intentGuid &&
          !secondOnIntent &&
          this._doubleTapEmptyCallback
        ) {
          const { clientX, clientY } = this._lastTap
          this._lastTap = null
          this._doubleTapEmptyCallback({ clientX, clientY })
          return
        }
        this._lastTap = null
      } else {
        this._lastTap = null
      }
    }

    // Track this pointer for tap-vs-drag detection. Tap (e.g. animate/perform filter) targets any
    // visible intent of any class; only dragging requires canDragIntent. Fixtures are never tapped here.
    if (spatial) {
      const intentGuid = this._findIntentAt(x, y, spatial, intent => this._policy.isIntentVisible(intent))
      this._tapTracker = {
        pointerId: ev.pointerId,
        downX: x,
        downY: y,
        downClientX: ev.clientX,
        downClientY: ev.clientY,
        intentGuid
      }
    }

    if (spatial) {
      const fixtureHit = this._findFixtureAt(x, y, spatial)
      if (fixtureHit !== null) {
        this._draggedFixtures.set(ev.pointerId, fixtureHit)
        this._capture(ev)
        return
      }
      const intentHit = this._findIntentAt(x, y, spatial)
      if (intentHit !== null) {
        this._draggedIntents.set(ev.pointerId, intentHit)
        this._capture(ev)
        return
      }
    }
    this._activePointers.add(ev.pointerId)
    this._capture(ev)
    this._pushSample(ev.clientX, ev.clientY, x, y)
  }

  /** @param {PointerEvent} ev */
  _onPointerMove (ev) {
    if (
      this._draggedFixtures.has(ev.pointerId) ||
      this._draggedFixtureHeightSliders.has(ev.pointerId) ||
      this._draggedIntents.has(ev.pointerId) ||
      this._draggedHeightSliders.has(ev.pointerId) ||
      this._activePointers.has(ev.pointerId)
    ) {
      this.markRenderActivity()
    }
    const sliderGuid = this._draggedHeightSliders.get(ev.pointerId)
    if (sliderGuid !== undefined) {
      const spatial = projectGraph.getSpatial()
      const simRect = this._viewport.getSimCanvasRect()
      if (!spatial || !simRect) return
      const yRange = spatial.y2 - spatial.y1
      if (!(yRange > 0)) return
      const intent =
        projectGraph.getEffectiveIntent(sliderGuid) ??
        projectGraph.getIntents().get(sliderGuid)
      const pos =
        intent && /** @type {Record<string, unknown>} */ (intent).position
      if (!Array.isArray(pos)) return
      const rect = this._canvas.getBoundingClientRect()
      const { px, py } = worldToCanvas(pos[0], pos[2], spatial, simRect, rect)
      const g = this._heightSliderGeometry(px, py, 0, true)
      const canvasY = ev.clientY - rect.top
      const frac = Math.min(1, Math.max(0, (g.bottomY - canvasY) / g.length))
      this._policy.onIntentHeightMove(sliderGuid, spatial.y1 + frac * yRange)
      return
    }
    const sliderFixtureId = this._draggedFixtureHeightSliders.get(ev.pointerId)
    if (sliderFixtureId !== undefined) {
      const spatial = projectGraph.getSpatial()
      const simRect = this._viewport.getSimCanvasRect()
      if (!spatial || !simRect) return
      const yRange = spatial.y2 - spatial.y1
      if (!(yRange > 0)) return
      const fixture = projectGraph.getFixtures().get(sliderFixtureId)
      const pos = fixture && /** @type {Record<string, unknown>} */ (fixture).position
      if (!Array.isArray(pos)) return
      const rect = this._canvas.getBoundingClientRect()
      const { px, py } = worldToCanvas(pos[0], pos[2], spatial, simRect, rect)
      const g = this._heightSliderGeometry(px, py, 0, true)
      const canvasY = ev.clientY - rect.top
      const frac = Math.min(1, Math.max(0, (g.bottomY - canvasY) / g.length))
      this._policy.onFixtureHeightMove(sliderFixtureId, spatial.y1 + frac * yRange)
      return
    }
    const fixtureId = this._draggedFixtures.get(ev.pointerId)
    if (fixtureId !== undefined) {
      const spatial = projectGraph.getSpatial()
      const simRect = this._viewport.getSimCanvasRect()
      if (!spatial || !simRect) return
      const m = clientToWorldViaSimCanvas(
        ev.clientX,
        ev.clientY,
        spatial,
        simRect
      )
      if (!m) return
      this._policy.onFixtureMove(fixtureId, m.wx, m.wz)
      return
    }
    const guid = this._draggedIntents.get(ev.pointerId)
    if (guid !== undefined) {
      const spatial = projectGraph.getSpatial()
      const simRect = this._viewport.getSimCanvasRect()
      if (!spatial || !simRect) return
      const m = clientToWorldViaSimCanvas(
        ev.clientX,
        ev.clientY,
        spatial,
        simRect
      )
      if (!m) return
      this._policy.onIntentMove(guid, m.wx, m.wz)
      return
    }
    if (!this._activePointers.has(ev.pointerId)) return
    const { x, y } = this._canvasPoint(ev)
    this._pushSample(ev.clientX, ev.clientY, x, y)
  }

  /** @param {PointerEvent} ev */
  _onPointerUp (ev) {
    this.markRenderActivity()
    // Confirm tap if pointer didn't move far (enables double-tap on next down)
    if (this._tapTracker?.pointerId === ev.pointerId) {
      const { x, y } = this._canvasPoint(ev)
      const dist = Math.hypot(
        x - this._tapTracker.downX,
        y - this._tapTracker.downY
      )
      const tappedIntent = this._tapTracker.intentGuid
      this._lastTap =
        dist < 10
          ? {
              x: this._tapTracker.downX,
              y: this._tapTracker.downY,
              t: performance.now(),
              clientX: this._tapTracker.downClientX,
              clientY: this._tapTracker.downClientY,
              intentGuid: tappedIntent
            }
          : null
      this._tapTracker = null
      if (
        dist < 10 &&
        tappedIntent &&
        this._singleTapIntentCallback &&
        !isIntentLocked(tappedIntent)
      ) {
        this._singleTapIntentCallback(tappedIntent)
      }
    }

    const guid = this._draggedIntents.get(ev.pointerId)
    if (guid !== undefined) this._policy.onIntentMoveEnd(guid)
    const sliderGuid = this._draggedHeightSliders.get(ev.pointerId)
    if (sliderGuid !== undefined) this._policy.onIntentHeightMoveEnd(sliderGuid)
    const sliderFixtureId = this._draggedFixtureHeightSliders.get(ev.pointerId)
    if (sliderFixtureId !== undefined) this._policy.onFixtureHeightMoveEnd(sliderFixtureId)
    this._activePointers.delete(ev.pointerId)
    this._draggedIntents.delete(ev.pointerId)
    this._draggedHeightSliders.delete(ev.pointerId)
    this._draggedFixtures.delete(ev.pointerId)
    this._draggedFixtureHeightSliders.delete(ev.pointerId)
    try {
      this._canvas.releasePointerCapture(ev.pointerId)
    } catch {
      /* ignore */
    }
  }

  /** @param {PointerEvent} ev */
  _capture (ev) {
    this._activePointers.add(ev.pointerId)
    try {
      this._canvas.setPointerCapture(ev.pointerId)
    } catch {
      /* ignore */
    }
  }

  /**
   * @param {PointerEvent} ev
   * @returns {{ x: number, y: number }}
   */
  _canvasPoint (ev) {
    const rect = this._canvas.getBoundingClientRect()
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   * @param {number} x
   * @param {number} y
   */
  _pushSample (clientX, clientY, x, y) {
    this._samples.push({ x, y, t: performance.now() })
    const spatial = projectGraph.getSpatial()
    if (!spatial) return
    const m = overlayClientToBboxMeters(clientX, clientY, this._canvas, spatial)
    if (!m) return
  }

  /**
   * Vertical height-slider geometry in overlay-canvas pixels. `t` is the height
   * fraction (0 = floor at the bottom, 1 = ceiling at the top). When engaged the
   * whole control is scaled up (touch zoom, mirrors the radial knob behaviour).
   * @param {number} px  cross pixel x
   * @param {number} py  cross pixel y
   * @param {number} t   height fraction 0..1
   * @param {boolean} engaged
   */
  _heightSliderGeometry (px, py, t, engaged) {
    const L = this._L
    const scale = engaged ? L.heightSliderEngagedScale : 1
    const length = L.heightSliderLengthPx * scale
    const knobR = L.heightSliderKnobRadiusPx * scale
    const trackX = px + L.heightSliderOffsetPx * scale
    const topY = py - length / 2
    const bottomY = py + length / 2
    const knobY = bottomY - t * length
    const hitPad = L.heightSliderHitPaddingPx
    return {
      scale,
      length,
      knobR,
      trackX,
      topY,
      bottomY,
      knobY,
      hitX0: trackX - hitPad,
      hitX1: trackX + hitPad,
      hitY0: topY - hitPad,
      hitY1: bottomY + hitPad
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} px
   * @param {number} py
   * @param {number} t       height fraction 0..1
   * @param {number} meters  height value for the label
   * @param {boolean} engaged
   */
  _drawHeightSlider (ctx, px, py, t, meters, engaged) {
    const L = this._L
    const g = this._heightSliderGeometry(px, py, t, engaged)
    ctx.save()
    ctx.lineCap = 'round'
    ctx.strokeStyle = L.heightSliderTrackRgba
    ctx.lineWidth = L.heightSliderWidthPx * g.scale
    ctx.beginPath()
    ctx.moveTo(g.trackX, g.topY)
    ctx.lineTo(g.trackX, g.bottomY)
    ctx.stroke()
    // floor baseline tick (0 m)
    ctx.beginPath()
    ctx.moveTo(g.trackX - 3 * g.scale, g.bottomY)
    ctx.lineTo(g.trackX + 3 * g.scale, g.bottomY)
    ctx.stroke()
    // knob
    ctx.beginPath()
    ctx.arc(g.trackX, g.knobY, g.knobR, 0, Math.PI * 2)
    ctx.fillStyle = L.heightSliderColorRgba
    ctx.fill()
    // metres label beside the knob
    ctx.font = `${L.heightSliderLabelFontPx * g.scale}px monospace`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = L.heightSliderLabelRgba
    ctx.fillText(`${meters.toFixed(1)} m`, g.trackX + g.knobR + 4 * g.scale, g.knobY)
    ctx.restore()
  }

  /**
   * Hit-test the (unzoomed) height sliders of visible target intents.
   * @param {number} cx canvas-local x
   * @param {number} cy canvas-local y
   * @param {HubSpatialState} spatial
   * @returns {string | null}
   */
  _findHeightSliderAt (cx, cy, spatial) {
    const yRange = spatial.y2 - spatial.y1
    if (!(yRange > 0)) return null
    const simRect = this._viewport.getSimCanvasRect()
    if (!simRect) return null
    const overlayRect = this._canvas.getBoundingClientRect()
    let nearest = null
    let nearestDx = Infinity
    for (const [guid, sharedIntent] of projectGraph.getIntents()) {
      const intent = projectGraph.getEffectiveIntent(guid) ?? sharedIntent
      const i = /** @type {Record<string, unknown>} */ (intent)
      if (!i || i.class !== 'target') continue
      if (isIntentLocked(guid)) continue
      // Grabbing follows the same gate as cross dragging: perform requires performEnabled.
      if (!this._policy.canDragIntent(intent)) continue
      const pos = /** @type {number[] | undefined} */ (i.position)
      if (!pos || pos.length < 3) continue
      const { px, py } = worldToCanvas(pos[0], pos[2], spatial, simRect, overlayRect)
      const t = Math.min(1, Math.max(0, (Number(pos[1]) - spatial.y1) / yRange))
      const g = this._heightSliderGeometry(px, py, t, false)
      const inside =
        cx >= g.hitX0 && cx <= g.hitX1 && cy >= g.hitY0 && cy <= g.hitY1
      if (!inside) continue
      const dx = Math.abs(cx - g.trackX)
      if (dx < nearestDx) {
        nearest = guid
        nearestDx = dx
      }
    }
    return nearest
  }

  /**
   * Small metres label drawn beneath a fixture marker (perform / fixtures-locked views).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} px
   * @param {number} py
   * @param {number} meters
   */
  _drawFixtureHeightLabel (ctx, px, py, meters) {
    const L = this._L
    ctx.save()
    ctx.font = `${L.heightSliderLabelFontPx}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = L.heightSliderLabelRgba
    ctx.fillText(`${meters.toFixed(1)} m`, px, py + L.heightSliderKnobRadiusPx + 6)
    ctx.restore()
  }

  /**
   * Hit-test the height sliders of draggable fixtures (only present while fixture editing
   * is unlocked, per {@link InteractionPolicy.canDragFixture}).
   * @param {number} cx canvas-local x
   * @param {number} cy canvas-local y
   * @param {HubSpatialState} spatial
   * @returns {string | null}
   */
  _findFixtureHeightSliderAt (cx, cy, spatial) {
    const yRange = spatial.y2 - spatial.y1
    if (!(yRange > 0)) return null
    const simRect = this._viewport.getSimCanvasRect()
    if (!simRect) return null
    const overlayRect = this._canvas.getBoundingClientRect()
    let nearest = null
    let nearestDx = Infinity
    for (const [id, fixture] of projectGraph.getFixtures()) {
      if (!this._policy.canDragFixture(fixture)) continue
      const f = /** @type {Record<string, unknown>} */ (fixture)
      const pos = /** @type {number[] | undefined} */ (f.position)
      if (!pos || pos.length < 3) continue
      const { px, py } = worldToCanvas(pos[0], pos[2], spatial, simRect, overlayRect)
      const t = Math.min(1, Math.max(0, (Number(pos[1]) - spatial.y1) / yRange))
      const g = this._heightSliderGeometry(px, py, t, false)
      const inside =
        cx >= g.hitX0 && cx <= g.hitX1 && cy >= g.hitY0 && cy <= g.hitY1
      if (!inside) continue
      const dx = Math.abs(cx - g.trackX)
      if (dx < nearestDx) {
        nearest = id
        nearestDx = dx
      }
    }
    return nearest
  }

  /**
   * @param {number} cx canvas-local x
   * @param {number} cy canvas-local y
   * @param {HubSpatialState} spatial
   * @returns {string | null}
   */
  _findIntentAt (cx, cy, spatial, accept = (intent) => this._policy.canDragIntent(intent)) {
    const simRect = this._viewport.getSimCanvasRect()
    if (!simRect) return null
    const overlayRect = this._canvas.getBoundingClientRect()
    const alreadyGrabbed = new Set(this._draggedIntents.values())
    let nearest = null
    let nearestDist = DRAG_HIT_RADIUS_PX
    for (const [guid, sharedIntent] of projectGraph.getIntents()) {
      if (alreadyGrabbed.has(guid)) continue
      const intent = projectGraph.getEffectiveIntent(guid) ?? sharedIntent
      if (!accept(intent)) continue
      const i = /** @type {Record<string, unknown>} */ (intent)
      const pos = /** @type {number[] | undefined} */ (i.position)
      if (!pos) continue
      const { px, py } = worldToCanvas(
        pos[0],
        pos[2],
        spatial,
        simRect,
        overlayRect
      )
      const dist = Math.hypot(cx - px, cy - py)
      if (dist < nearestDist) {
        nearest = guid
        nearestDist = dist
      }
    }
    return nearest
  }

  /**
   * @param {number} cx
   * @param {number} cy
   * @param {HubSpatialState} spatial
   * @returns {string | null}
   */
  _findFixtureAt (cx, cy, spatial) {
    const simRect = this._viewport.getSimCanvasRect()
    if (!simRect) return null
    const overlayRect = this._canvas.getBoundingClientRect()
    const alreadyGrabbed = new Set(this._draggedFixtures.values())
    let nearest = null
    let nearestDist = DRAG_HIT_RADIUS_PX
    for (const [id, fixture] of projectGraph.getFixtures()) {
      if (alreadyGrabbed.has(id)) continue
      if (!this._policy.canDragFixture(fixture)) continue
      const f = /** @type {Record<string, unknown>} */ (fixture)
      const pos = /** @type {number[] | undefined} */ (f.position)
      if (!pos) continue
      const { px, py } = worldToCanvas(
        pos[0],
        pos[2],
        spatial,
        simRect,
        overlayRect
      )
      const dist = Math.hypot(cx - px, cy - py)
      if (dist < nearestDist) {
        nearest = id
        nearestDist = dist
      }
    }
    return nearest
  }
}
