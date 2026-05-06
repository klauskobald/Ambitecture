import { projectGraph } from '../core/projectGraph.js'
import { isIntentLocked } from '../core/intentLockRegistry.js'
import { performPolicy } from '../viewport/interactionPolicies.js'
import { worldToCanvas } from '../viewport/spatialMath.js'
import { resolveDescriptorsForClass } from '../core/systemCapabilities.js'
import { queueIntentUpdate } from '../core/outboundQueue.js'
import { ScalarRadialKnob } from './ScalarRadialKnob.js'

/** World height (meters, XZ) of the nominal pivot marker — not intent spread radius. Scales with map zoom. */
export const PERFORM_HUD_ICON_WORLD_METERS = 0.28

/** Extra screen pixels between marker top and HUD bottom (after {@link PERFORM_HUD_ICON_ANCHOR_FRAC}). */
export const PERFORM_HUD_ICON_EXTRA_GAP_PX = 2

/**
 * Where the HUD anchor sits between pivot and “top of nominal marker”:
 * 0.5 = flush with top of marker (HUD covers upper half when overlapping); lower = overlap more; higher = HUD higher.
 */
export const PERFORM_HUD_ICON_ANCHOR_FRAC = 0.5

export class PerformQuickPanelHud {
  /**
   * @param {import('../viewport/overlayCanvas.js').OverlayCanvas} overlay
   */
  constructor (overlay) {
    this._overlay = overlay
    const layer = document.getElementById('perform-hud-layer')
    if (!layer) throw new Error('#perform-hud-layer missing from DOM.')
    this._layer = layer
    /** @type {Map<string, { root: HTMLElement, knobs: ScalarRadialKnob[], descriptorKeys: string }>} */
    this._panels = new Map()

    /** @type {boolean} */
    this._runner = false
    /** @type {number} */
    this._raf = 0
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
    this._unsub = projectGraph.subscribe(() => this._reconcilePanels())
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
      if (isIntentLocked(guid)) {
        const stale = this._panels.get(guid)
        if (stale) {
          for (const k of stale.knobs) k.destroy()
          stale.root.remove()
          this._panels.delete(guid)
        }
        continue
      }
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
          if (!d || d.type !== 'scalar') continue
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

      /** @type {ScalarRadialKnob[]} */
      const knobs = []
      for (const d of wantedDescriptors) {
        /** @type {Record<string, unknown>} */
        const desc = /** @type {Record<string, unknown>} */ (d)
        const dotKeyStr = /** @type {string} */ (desc.dotKey)
        const knob = new ScalarRadialKnob({
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

    for (const [, pane] of this._panels) {
      const id = String(pane.root.dataset.intentGuid ?? '')
      const intent =
        projectGraph.getEffectiveIntent(id) ?? projectGraph.getIntents().get(id)
      if (!intent) {
        pane.root.style.visibility = 'hidden'
        continue
      }
      const i = /** @type {Record<string, unknown>} */ (intent)
      const pos = /** @type {number[] | undefined} */ (i.position)
      if (!pos || pos.length < 3) {
        pane.root.style.visibility = 'hidden'
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
      const lx = overlayRect.left - layerRect.left + px
      // translate(-50%,-100%): (lx, ly) is bottom-center of HUD — stack on small pivot marker, not spread radius.
      const ly =
        overlayRect.top -
        layerRect.top +
        py -
        iconPx * PERFORM_HUD_ICON_ANCHOR_FRAC -
        PERFORM_HUD_ICON_EXTRA_GAP_PX
      pane.root.style.position = 'absolute'
      pane.root.style.visibility = ''
      pane.root.style.left = `${Math.round(lx)}px`
      pane.root.style.top = `${Math.round(Math.max(8, ly))}px`
      pane.root.style.pointerEvents = 'auto'
      pane.root.style.transform = 'translate(-50%, -100%)'
    }
  }
}
