/**
 * @typedef {import('../core/stores.js').HubSpatialState} HubSpatialState
 */

/**
 * Maps viewport clientX/clientY to world meters using the overlay canvas rect and zone bbox.
 * @param {number} clientX
 * @param {number} clientY
 * @param {HTMLCanvasElement} overlayCanvas
 * @param {HubSpatialState} s
 * @returns {{ wx: number, wy: number, wz: number, nx: number, ny: number } | null}
 */
export function overlayClientToBboxMeters (clientX, clientY, overlayCanvas, s) {
  const r = overlayCanvas.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return null
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null
  const nx = (clientX - r.left) / r.width
  const ny = (clientY - r.top) / r.height
  return {
    wx: s.x1 + nx * (s.x2 - s.x1),
    wy: s.y1,
    wz: s.z1 + ny * (s.z2 - s.z1),
    nx,
    ny
  }
}

/**
 * Maps world XZ to overlay canvas pixel coords using the simulator canvas's screen rect.
 * @param {number} wx
 * @param {number} wz
 * @param {HubSpatialState} spatial
 * @param {DOMRect} simRect   getBoundingClientRect() of the simulator's #sim-canvas
 * @param {DOMRect} overlayRect  getBoundingClientRect() of the overlay canvas
 * @returns {{ px: number, py: number }}
 */
export function worldToCanvas (wx, wz, spatial, simRect, overlayRect) {
  const nx = (wx - spatial.x1) / (spatial.x2 - spatial.x1)
  const ny = (wz - spatial.z1) / (spatial.z2 - spatial.z1)
  return {
    px: simRect.left - overlayRect.left + nx * simRect.width,
    py: simRect.top - overlayRect.top + ny * simRect.height
  }
}

/**
 * Maps a client pointer position to world XZ using the simulator canvas's screen rect.
 * @param {number} clientX
 * @param {number} clientY
 * @param {HubSpatialState} spatial
 * @param {DOMRect} simRect
 * @returns {{ wx: number, wz: number } | null}
 */
export function clientToWorldViaSimCanvas (clientX, clientY, spatial, simRect) {
  const nx = (clientX - simRect.left) / simRect.width
  const ny = (clientY - simRect.top) / simRect.height
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null
  return {
    wx: spatial.x1 + nx * (spatial.x2 - spatial.x1),
    wz: spatial.z1 + ny * (spatial.z2 - spatial.z1)
  }
}

/**
 * @param {number[]} position
 * @param {number[][]} zoneBoxes
 * @returns {boolean}
 */
export function isPositionInsideAnyZone (position, zoneBoxes) {
  return zoneBoxes.some(
    zone =>
      position[0] >= zone[0] && position[0] <= zone[3] &&
      position[1] >= zone[1] && position[1] <= zone[4] &&
      position[2] >= zone[2] && position[2] <= zone[5]
  )
}
