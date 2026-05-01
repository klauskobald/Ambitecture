import { toHSL } from '../../core/color.js'

const CANVAS_W = 320
const CANVAS_H = 220
const MID_Y = Math.floor(CANVAS_H / 2) // split line: bottom = S=1 L 0→0.5, top = S 1→0 L 0.5→1

/**
 * HSL palette plugin descriptor.
 * X axis: Hue 0–360°.
 * Y axis bottom half: S=1 fixed, L 0 (black) → 0.5 (full saturation at midline).
 * Y axis top half:    S 1→0, L 0.5→1 (saturated → white at top).
 */
export const hslPalette = {
  id: 'hsl',
  label: 'HSL',

  /**
   * @param {HTMLElement} container
   * @param {(color: { h: number, s: number, l: number }) => void} onChange
   * @returns {{ setColor: (colorObj: unknown) => void, destroy: () => void }}
   */
  mount (container, onChange) {
    const wrap = document.createElement('div')
    wrap.className = 'palette-hsl'

    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_W
    canvas.height = CANVAS_H
    canvas.className = 'palette-hsl-canvas'
    canvas.style.touchAction = 'none'
    wrap.appendChild(canvas)

    const labels = document.createElement('div')
    labels.className = 'palette-hsl-labels'
    labels.innerHTML = '<span>0°</span><span>120°</span><span><em>H</em></span><span>240°</span><span>360°</span>'
    wrap.appendChild(labels)

    container.appendChild(wrap)

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D unavailable')

    // ── Draw gradient via ImageData for accuracy ──────────────────
    const img = ctx.createImageData(CANVAS_W, CANVAS_H)
    for (let py = 0; py < CANVAS_H; py++) {
      let s, l
      if (py < MID_Y) {
        // Top half: S 1→0, L 0.5→1
        const f = py / (MID_Y - 1 || 1) // 0 at top, 1 at midline
        s = f
        l = 1 - 0.5 * f
      } else {
        // Bottom half: S=1 fixed, L 0.5→0
        const f = (py - MID_Y) / (CANVAS_H - 1 - MID_Y || 1) // 0 at midline, 1 at bottom
        s = 1
        l = 0.5 * (1 - f)
      }
      for (let px = 0; px < CANVAS_W; px++) {
        const h = (px / (CANVAS_W - 1)) * 360
        const { r, g, b } = hslToRGB01(h, s, l)
        const i = (py * CANVAS_W + px) * 4
        img.data[i]     = Math.round(r * 255)
        img.data[i + 1] = Math.round(g * 255)
        img.data[i + 2] = Math.round(b * 255)
        img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)

    // ── Crosshair state ───────────────────────────────────────────
    let currentH = 0
    let currentS = 1
    let currentL = 0.5
    let isDragging = false

    function drawCrosshair () {
      ctx.putImageData(img, 0, 0)
      const px = (currentH / 360) * (CANVAS_W - 1)
      let py
      if (currentL <= 0.5) {
        // Bottom half: S=1, L 0→0.5
        py = MID_Y + (1 - currentL / 0.5) * (CANVAS_H - 1 - MID_Y)
      } else {
        // Top half: S 0→1, L 1→0.5
        py = currentS * (MID_Y - 1)
      }
      ctx.save()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(px, py, 6, 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.arc(px, py, 7, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    /**
     * @param {number} clientX
     * @param {number} clientY
     */
    function pickFromClient (clientX, clientY) {
      const rect = canvas.getBoundingClientRect()
      const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
      const py = ny * (CANVAS_H - 1)
      currentH = nx * 360
      if (py < MID_Y) {
        // Top half: S 1→0, L 0.5→1
        const f = py / (MID_Y - 1 || 1) // 0 at top, 1 at midline
        currentS = f
        currentL = 1 - 0.5 * f
      } else {
        // Bottom half: S=1, L 0.5→0
        const f = (py - MID_Y) / (CANVAS_H - 1 - MID_Y || 1) // 0 at midline, 1 at bottom
        currentS = 1
        currentL = 0.5 * (1 - f)
      }
      drawCrosshair()
      onChange({ h: currentH, s: currentS, l: currentL })
    }

    canvas.addEventListener('pointerdown', ev => {
      isDragging = true
      canvas.setPointerCapture(ev.pointerId)
      pickFromClient(ev.clientX, ev.clientY)
    })
    canvas.addEventListener('pointermove', ev => {
      if (!isDragging) return
      pickFromClient(ev.clientX, ev.clientY)
    })
    canvas.addEventListener('pointerup', () => { isDragging = false })
    canvas.addEventListener('pointercancel', () => { isDragging = false })

    drawCrosshair()

    return {
      setColor (colorObj) {
        const { h, s, l } = toHSL(colorObj)
        currentH = h
        currentS = Math.max(0, Math.min(1, s))
        currentL = Math.max(0, Math.min(1, l))
        drawCrosshair()
      },
      destroy () {
        wrap.remove()
      }
    }
  }
}

/**
 * HSL → sRGB (0-1 each). Inline to avoid import in hot pixel loop.
 * @param {number} h @param {number} s @param {number} l
 */
function hslToRGB01 (h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60)       { r = c; g = x; b = 0 }
  else if (h < 120) { r = x; g = c; b = 0 }
  else if (h < 180) { r = 0; g = c; b = x }
  else if (h < 240) { r = 0; g = x; b = c }
  else if (h < 300) { r = x; g = 0; b = c }
  else              { r = c; g = 0; b = x }
  return { r: r + m, g: g + m, b: b + m }
}
