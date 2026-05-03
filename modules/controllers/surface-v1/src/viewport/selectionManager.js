import { worldToCanvas } from './spatialMath.js'

/**
 * @typedef {import('../core/stores.js').HubSpatialState} HubSpatialState
 */

/**
 * Generic interactive bubble overlay for a set of world-positioned objects.
 *
 * Callers provide:
 *  - a source of objects (entries of [id, obj])
 *  - a world-position extractor per object
 *  - a tap callback per object
 *  - a draw callback that renders the bubble for each object
 *
 * The manager is display-only between frames; it holds no selection state —
 * that belongs to the caller (e.g. the allowances graph in stores.js).
 *
 * @template T
 */
export class SelectionManager {
  /**
   * @param {object} opts
   * @param {() => Iterable<[string, T]>} opts.getObjects
   * @param {(obj: T) => { wx: number, wz: number } | null} opts.getWorldPos
   * @param {(id: string, obj: T) => void} opts.onTap
   * @param {(ctx: CanvasRenderingContext2D, px: number, py: number, id: string, obj: T) => void} opts.drawBubble
   * @param {number} [opts.hitRadiusPx]  tap detection radius in canvas pixels (default 32)
   */
  constructor (opts) {
    this._getObjects = opts.getObjects
    this._getWorldPos = opts.getWorldPos
    this._onTap = opts.onTap
    this._drawBubble = opts.drawBubble
    this._hitRadiusPx = opts.hitRadiusPx ?? 32
  }

  /**
   * Draw all bubbles. Called from the OverlayCanvas frame loop.
   * @param {CanvasRenderingContext2D} ctx
   * @param {HubSpatialState} spatial
   * @param {DOMRect} simRect
   * @param {DOMRect} overlayRect
   */
  draw (ctx, spatial, simRect, overlayRect) {
    for (const [id, obj] of this._getObjects()) {
      const pos = this._getWorldPos(obj)
      if (!pos) continue
      const { px, py } = worldToCanvas(
        pos.wx,
        pos.wz,
        spatial,
        simRect,
        overlayRect
      )
      this._drawBubble(ctx, px, py, id, obj)
    }
  }

  /**
   * Test whether a canvas-local tap hits any bubble and call onTap if so.
   * Returns true if the tap was consumed.
   * @param {number} cx  canvas-local x
   * @param {number} cy  canvas-local y
   * @param {HubSpatialState} spatial
   * @param {DOMRect} simRect
   * @param {DOMRect} overlayRect
   * @returns {boolean}
   */
  handleTap (cx, cy, spatial, simRect, overlayRect) {
    let nearestId = null
    let nearestObj = null
    let nearestDist = this._hitRadiusPx
    for (const [id, obj] of this._getObjects()) {
      const pos = this._getWorldPos(obj)
      if (!pos) continue
      const { px, py } = worldToCanvas(
        pos.wx,
        pos.wz,
        spatial,
        simRect,
        overlayRect
      )
      const dist = Math.hypot(cx - px, cy - py)
      if (dist < nearestDist) {
        nearestId = id
        nearestObj = obj
        nearestDist = dist
      }
    }
    if (nearestId !== null && nearestObj !== null) {
      this._onTap(nearestId, nearestObj)
      return true
    }
    return false
  }
}
