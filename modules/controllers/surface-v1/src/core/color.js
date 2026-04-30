/**
 * Display-conversion utility for surface-v1.
 * Converts any recognized color format to CSS-renderable RGB.
 * Internal color math matches hub/src/color.ts and simulator-2d/src/color.js.
 */

/**
 * Detect the format of a raw color object.
 * @param {unknown} colorObj
 * @returns {'hsl' | 'xyy' | 'hex' | 'rgbArray' | 'rgb' | null}
 */
export function detectFormat (colorObj) {
  if (colorObj === null || typeof colorObj !== 'object' || Array.isArray(colorObj)) return null
  const o = /** @type {Record<string, unknown>} */ (colorObj)
  if (typeof o.h === 'number' && typeof o.s === 'number' && typeof o.l === 'number') return 'hsl'
  if (typeof o.x === 'number' && typeof o.y === 'number' && typeof o.Y === 'number') return 'xyy'
  if (typeof o.rgb === 'string' && o.rgb.startsWith('#')) return 'hex'
  if (Array.isArray(o.rgb)) return 'rgbArray'
  if (typeof o.r === 'number' && typeof o.g === 'number' && typeof o.b === 'number') return 'rgb'
  return null
}

/**
 * Convert any recognized color format to a CSS rgb() string.
 * @param {unknown} colorObj
 * @returns {string}  e.g. 'rgb(255, 128, 0)'
 */
export function toCSSRGB (colorObj) {
  const fmt = detectFormat(colorObj)
  if (!fmt) return 'rgb(128, 128, 128)'
  const o = /** @type {Record<string, unknown>} */ (colorObj)

  switch (fmt) {
    case 'hsl': {
      const { r, g, b } = hslToSRGB(
        /** @type {number} */ (o.h),
        /** @type {number} */ (o.s),
        /** @type {number} */ (o.l)
      )
      return toRGBString(r, g, b)
    }
    case 'xyy': {
      const { r, g, b } = xyyToSRGB(
        /** @type {number} */ (o.x),
        /** @type {number} */ (o.y),
        /** @type {number} */ (o.Y)
      )
      return toRGBString(r, g, b)
    }
    case 'hex': {
      const hex = String(o.rgb).replace('#', '')
      const r = parseInt(hex.substring(0, 2), 16) / 255
      const g = parseInt(hex.substring(2, 4), 16) / 255
      const b = parseInt(hex.substring(4, 6), 16) / 255
      return toRGBString(r, g, b)
    }
    case 'rgbArray': {
      const rgb = /** @type {number[]} */ (o.rgb)
      return toRGBString(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
    }
    case 'rgb': {
      return toRGBString(
        /** @type {number} */ (o.r) / 255,
        /** @type {number} */ (o.g) / 255,
        /** @type {number} */ (o.b) / 255
      )
    }
  }
}

/**
 * Convert any recognized color format to { h, s, l } (h: 0-360, s: 0-1, l: 0-1).
 * Used to initialize HSL palette crosshair when opening on a non-HSL intent.
 * @param {unknown} colorObj
 * @returns {{ h: number, s: number, l: number }}
 */
export function toHSL (colorObj) {
  const fmt = detectFormat(colorObj)
  if (fmt === 'hsl') {
    const o = /** @type {Record<string, unknown>} */ (colorObj)
    return { h: /** @type {number} */ (o.h), s: /** @type {number} */ (o.s), l: /** @type {number} */ (o.l) }
  }
  // Convert through linear RGB for all other formats
  const css = toCSSRGB(colorObj)
  const m = css.match(/\d+/g)
  if (!m) return { h: 0, s: 1, l: 0.5 }
  return rgbToHSL(Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255)
}

// ─── Internal conversion helpers ──────────────────────────────────────────────

/** @param {number} r @param {number} g @param {number} b  (all 0-1) */
function toRGBString (r, g, b) {
  return `rgb(${Math.round(clamp01(r) * 255)}, ${Math.round(clamp01(g) * 255)}, ${Math.round(clamp01(b) * 255)})`
}

/** @param {number} v */
function clamp01 (v) { return Math.max(0, Math.min(1, v)) }

/**
 * HSL → gamma-corrected sRGB (0-1 each).
 * h: 0-360, s: 0-1, l: 0-1
 * @param {number} h @param {number} s @param {number} l
 * @returns {{ r: number, g: number, b: number }}
 */
function hslToSRGB (h, s, l) {
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

/**
 * CIE xyY → gamma-corrected sRGB (0-1 each). D65, same matrix as simulator-2d/color.js.
 * @param {number} x @param {number} y @param {number} Y
 * @returns {{ r: number, g: number, b: number }}
 */
function xyyToSRGB (x, y, Y) {
  if (y === 0) return { r: 0, g: 0, b: 0 }
  const X = (Y / y) * x
  const Z = (Y / y) * (1 - x - y)
  const rLin =  3.2406 * X - 1.5372 * Y - 0.4986 * Z
  const gLin = -0.9689 * X + 1.8758 * Y + 0.0415 * Z
  const bLin =  0.0557 * X - 0.2040 * Y + 1.0570 * Z
  return { r: gammaEncode(rLin), g: gammaEncode(gLin), b: gammaEncode(bLin) }
}

/** sRGB gamma encoding */
function gammaEncode (v) {
  const c = clamp01(v)
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

/**
 * sRGB (0-1) → { h: 0-360, s: 0-1, l: 0-1 }
 * @param {number} r @param {number} g @param {number} b
 */
function rgbToHSL (r, g, b) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
    case g: h = ((b - r) / d + 2) / 6; break
    case b: h = ((r - g) / d + 4) / 6; break
  }
  return { h: h * 360, s, l }
}
