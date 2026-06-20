import { projectGraph } from '../core/projectGraph.js'
import { performPolicy } from '../viewport/interactionPolicies.js'
import { worldToCanvas } from '../viewport/spatialMath.js'
import {
  resolveDescriptorsForClass,
  resolveIntentDescriptorUiKind
} from '../core/systemCapabilities.js'
import { queueIntentUpdate } from '../core/outboundQueue.js'
import { ScalarRadialKnobSvg } from '../edit/components/ScalarRadialKnobSvg.js'
import { intentLayer } from '../core/stores.js'

/** World height (meters, XZ) of the nominal pivot marker — not intent spread radius. Scales with map zoom. */
export const PERFORM_HUD_ICON_WORLD_METERS = 0.28

/** Extra screen pixels between marker top and HUD bottom (after {@link PERFORM_HUD_ICON_ANCHOR_FRAC}). */
export const PERFORM_HUD_ICON_EXTRA_GAP_PX = 2

/**
 * Where the HUD anchor sits between pivot and “top of nominal marker”:
 * 0.5 = flush with top of marker (HUD covers upper half when overlapping); lower = overlap more; higher = HUD higher.
 */
export const PERFORM_HUD_ICON_ANCHOR_FRAC = 0.5

/** Snap to target when within this many pixels (Euclidean in layer space). */
export const PERFORM_HUD_LAYOUT_LERP_MIN_DIST_PX = 1

/**
 * Exponential smoothing rate (1/s) for HUD follow: higher = snappier.
 * Position delta per frame uses `1 - exp(-lambda * dt)`.
 */
export const PERFORM_HUD_LAYOUT_LERP_LAMBDA = 10

export class PerformQuickPanelHud {
  /**
   * @param {import('../viewport/overlayCanvas.js').OverlayCanvas} overlay
   * @param {HTMLElement} hudLayer
   */
  constructor (overlay, hudLayer) {
    this._overlay = overlay
    if (!hudLayer) throw new Error('PerformQuickPanelHud requires a HUD layer element.')
    this._layer = hudLayer
    /** @type {Map<string, { root: HTMLElement, knobs: ScalarRadialKnobSvg[], descriptorKeys: string, layoutX?: number, layoutY?: number }>} */
    this._panels = new Map()

    /** @type {boolean} */
    this._runner = false
    /** @type {number} */
    this._raf = 0
    /** @type {number} */
    this._lastLayoutFrameMs = 0
    this._lastLayoutActivityMs = 0
    this._inactivityStopMs = 1000
    /** @type {(() => void) | null} */
    this._tick = null
    /** @type {(() => void) | null} */
    this._unsub = null
  }

  start () {
    if (this._runner) return
    this._runner = true
    this._lastLayoutFrameMs = 0
    this._layer.style.display = ''
    this._layer.hidden = false
    this._tick = () => {
      if (!this._runner) return
      this._layoutPanels()
      const idleMs = performance.now() - this._lastLayoutActivityMs
      if (idleMs < this._inactivityStopMs) {
        this._raf = requestAnimationFrame(this._tick)
      } else {
        this._raf = 0
      }
    }
    // Knob values follow runtime patches (animation), so subscribe to runtime too.
    // `scenes` for active scene overlay changes; `controller` for quickPanelDotKeys.
    this._unsub = projectGraph.subscribe(
      ['intents:def', 'intents:runtime', 'scenes', 'controller'],
      () => this._reconcilePanels()
    )
    this._reconcilePanels()
    this.markLayoutActivity()
  }

  /** Extends HUD layout rAF (see `_inactivityStopMs`). */
  markLayoutActivity () {
    this._lastLayoutActivityMs = performance.now()
    if (!this._runner || !this._tick) return
    if (!this._raf) {
      this._raf = requestAnimationFrame(this._tick)
    }
  }

  stop () {
    this._runner = false
    if (this._raf) cancelAnimationFrame(this._raf)
    this._raf = 0
    this._tick = null
    this._unsub?.()
    this._unsub = null

    for (const [, pane] of this._panels) {
      for (const k of pane.knobs) k.destroy()
      pane.root.remove()
    }
    this._panels.clear()

    while (this._layer.firstChild) this._layer.firstChild.remove()
    this._layer.hidden = true
  }

  // ─────────────────────────────────────────────────────────────────────────

  /** @returns {void} */
  _reconcilePanels () {
    const nextGuids = new Set()

    for (const [guid, raw] of projectGraph.getIntents()) {
      const intent = projectGraph.getEffectiveIntent(guid) ?? raw
      if (!intent) continue
      if (!performPolicy.isIntentVisible(intent)) continue

      const qKeys = projectGraph.getQuickPanelDotKeys(guid)
      if (qKeys.length === 0) continue

      /** @type {Record<string, unknown>} */
      const i = /** @type {Record<string, unknown>} */ (intent)
      const cls =
        typeof i.class === 'string' && i.class.length > 0 ? i.class : 'light'
      const allDesc = resolveDescriptorsForClass(cls)
      /** @type {Record<string, unknown>[]} */
      const wantedDescriptors = []
      if (allDesc) {
        /** @type {Map<string, Record<string, unknown>>} */
        const byDot = new Map()
        for (const dRaw of allDesc) {
          const d = /** @type {Record<string, unknown>} */ (dRaw)
          const dk = typeof d.dotKey === 'string' ? d.dotKey : ''
          if (dk) byDot.set(dk, d)
        }
        for (const dotKey of qKeys) {
          if (
            projectGraph.getEffectiveIntentProperty(guid, dotKey) === undefined
          ) {
            continue
          }
          const d = byDot.get(dotKey)
          if (
            !d ||
            resolveIntentDescriptorUiKind(
              /** @type {Record<string, unknown>} */ (d)
            ) !== 'scalar'
          )
            continue
          wantedDescriptors.push(d)
        }
      }

      if (wantedDescriptors.length === 0) {
        const stale = this._panels.get(guid)
        if (stale) {
          for (const k of stale.knobs) k.destroy()
          stale.root.remove()
          this._panels.delete(guid)
        }
        continue
      }

      nextGuids.add(guid)

      const sig = `${cls}:${wantedDescriptors
        .map(d => /** @type {Record<string, unknown>} */ (d).dotKey)
        .join(',')}`
      let pane = this._panels.get(guid)
      if (
        pane &&
        pane.descriptorKeys === sig &&
        pane.knobs.length === wantedDescriptors.length
      ) {
        for (let ix = 0; ix < wantedDescriptors.length; ix++) {
          const knob = pane.knobs[ix]
          if (knob) knob.syncFromExternal()
        }
        continue
      }

      if (pane) {
        for (const k of pane.knobs) k.destroy()
        pane.root.remove()
      }

      /** @type {HTMLElement} */
      const root = document.createElement('div')
      root.className = 'quick-panel-hud'
      root.hidden = false
      root.dataset.intentGuid = guid

      const row = document.createElement('div')
      row.className = 'quick-panel-hud__knobs'
      row.dataset.help = 'stage.perform.knob'

      /** @type {ScalarRadialKnobSvg[]} */
      const knobs = []
      for (const d of wantedDescriptors) {
        /** @type {Record<string, unknown>} */
        const desc = /** @type {Record<string, unknown>} */ (d)
        const dotKeyStr = /** @type {string} */ (desc.dotKey)
        const knob = new ScalarRadialKnobSvg({
          descriptor: desc,
          intentGuid: guid,
          readValue: () =>
            projectGraph.getEffectiveIntentProperty(guid, dotKeyStr),
          onCommit: value => {
            const updated = projectGraph.applyPerformIntentParamUpdate(
              guid,
              dotKeyStr,
              value,
              !!desc.allowOverlay
            )
            if (updated) queueIntentUpdate(updated)
          }
        })
        knob.mount(row)
        knobs.push(knob)
      }

      root.appendChild(row)
      this._layer.appendChild(root)
      this._panels.set(guid, { root, knobs, descriptorKeys: sig })
    }

    for (const [guid, pane] of [...this._panels.entries()]) {
      if (!nextGuids.has(guid)) {
        for (const k of pane.knobs) k.destroy()
        pane.root.remove()
        this._panels.delete(guid)
      }
    }

    this.markLayoutActivity()
  }

  /** @returns {void} */
  _layoutPanels () {
    const spatial = projectGraph.getSpatial()
    const { canvas, viewport } = this._overlay.getHudPositioningContext()
    const simRect = viewport.getSimCanvasRect()
    if (!spatial || !simRect) return
    const overlayRect = canvas.getBoundingClientRect()
    const layerRect = this._layer.getBoundingClientRect()

    const now = performance.now()
    let dtSec = 0
    if (this._lastLayoutFrameMs > 0) {
      dtSec = Math.min(0.1, Math.max(0, (now - this._lastLayoutFrameMs) / 1000))
    }
    this._lastLayoutFrameMs = now
    const lerpAlpha =
      dtSec > 0 ? 1 - Math.exp(-PERFORM_HUD_LAYOUT_LERP_LAMBDA * dtSec) : 0

    let anyHudStillLerping = false

    for (const [, pane] of this._panels) {
      const id = String(pane.root.dataset.intentGuid ?? '')
      const intent =
        projectGraph.getEffectiveIntent(id) ?? projectGraph.getIntents().get(id)
      if (!intent) {
        pane.root.style.visibility = 'hidden'
        pane.layoutX = undefined
        pane.layoutY = undefined
        continue
      }
      const i = /** @type {Record<string, unknown>} */ (intent)
      const pos = /** @type {number[] | undefined} */ (i.position)
      if (!pos || pos.length < 3) {
        pane.root.style.visibility = 'hidden'
        pane.layoutX = undefined
        pane.layoutY = undefined
        continue
      }
      const { px, py } = worldToCanvas(
        pos[0],
        pos[2],
        spatial,
        simRect,
        overlayRect
      )
      const spanM = Math.max(1e-9, spatial.x2 - spatial.x1)
      const mPerPx = spanM / Math.max(1, simRect.width)
      const iconPx = PERFORM_HUD_ICON_WORLD_METERS / mPerPx
      const tx = overlayRect.left - layerRect.left + px
      // translate(-50%,-100%): (tx, ty) is bottom-center of HUD — stack on small pivot marker, not spread radius.
      const ty =
        overlayRect.top -
        layerRect.top +
        py -
        iconPx * PERFORM_HUD_ICON_ANCHOR_FRAC -
        PERFORM_HUD_ICON_EXTRA_GAP_PX

      let lx = pane.layoutX
      let ly = pane.layoutY
      if (lx === undefined || ly === undefined) {
        lx = tx
        ly = ty
      } else {
        const dist = Math.hypot(tx - lx, ty - ly)
        if (dist <= PERFORM_HUD_LAYOUT_LERP_MIN_DIST_PX) {
          lx = tx
          ly = ty
        } else if (lerpAlpha > 0) {
          lx += (tx - lx) * lerpAlpha
          ly += (ty - ly) * lerpAlpha
        }
      }
      pane.layoutX = lx
      pane.layoutY = ly

      if (Math.hypot(tx - lx, ty - ly) > PERFORM_HUD_LAYOUT_LERP_MIN_DIST_PX) {
        anyHudStillLerping = true
      }

      pane.root.style.position = 'absolute'
      pane.root.style.visibility = ''
      pane.root.style.left = `${Math.round(lx)}px`
      pane.root.style.top = `${Math.round(Math.max(8, ly))}px`
      pane.root.style.pointerEvents = 'auto'
      pane.root.style.transform = 'translate(-50%, -100%)'
      // Higher-layer intents stack on top of lower ones (NaN/missing → 0).
      const layerNum = intentLayer(intent)
      pane.root.style.zIndex = String(Number.isFinite(layerNum) ? layerNum : 0)
    }

    if (anyHudStillLerping) {
      this._lastLayoutActivityMs = performance.now()
    }
  }
}
