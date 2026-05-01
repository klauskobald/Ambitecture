import * as statusDisplay from '../app/statusDisplay.js'

/**
 * @typedef {object} LayoutConfig
 * @property {number} pagePaddingPx
 * @property {number} mainGapPx
 * @property {number} simStackMinHeightVh
 * @property {number} controlStripMinHeightPx
 * @property {number} iframeZIndex
 * @property {number} overlayZIndex
 * @property {number} overlayFingerRadiusPx
 * @property {string} overlayFingerFillRgba
 * @property {string} overlayFingerStrokeRgba
 * @property {number} overlayLineWidthPx
 * @property {number} overlayTrailFadeMs
 */

const REQUIRED_LAYOUT_KEYS = /** @type {(keyof LayoutConfig)[]} */ ([
  'pagePaddingPx',
  'mainGapPx',
  'simStackMinHeightVh',
  'controlStripMinHeightPx',
  'iframeZIndex',
  'overlayZIndex',
  'overlayFingerRadiusPx',
  'overlayFingerFillRgba',
  'overlayFingerStrokeRgba',
  'overlayLineWidthPx',
  'overlayTrailFadeMs'
])

/**
 * @param {unknown} cfg
 * @returns {cfg is { SIMULATOR_IFRAME_URL: string, AMBITECTURE_HUB_URL: string, GEO_LOCATION: string, CONTROLLER_GUID: string, SIMULATOR_RENDERER_GUID: string, LAYOUT: LayoutConfig }}
 */
function validateControllerConfig (cfg) {
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) return false
  const o = /** @type {Record<string, unknown>} */ (cfg)
  if (typeof o.SIMULATOR_IFRAME_URL !== 'string' || o.SIMULATOR_IFRAME_URL.trim() === '') return false
  if (typeof o.AMBITECTURE_HUB_URL !== 'string' || o.AMBITECTURE_HUB_URL.trim() === '') return false
  if (typeof o.GEO_LOCATION !== 'string' || o.GEO_LOCATION.trim() === '') return false
  if (typeof o.CONTROLLER_GUID !== 'string' || o.CONTROLLER_GUID.trim() === '') return false
  if (typeof o.SIMULATOR_RENDERER_GUID !== 'string' || o.SIMULATOR_RENDERER_GUID.trim() === '') return false
  const layout = o.LAYOUT
  if (layout === null || typeof layout !== 'object' || Array.isArray(layout)) return false
  const L = /** @type {Record<string, unknown>} */ (layout)
  for (const key of REQUIRED_LAYOUT_KEYS) {
    if (!(key in L)) return false
    const v = L[key]
    if (key === 'overlayFingerFillRgba' || key === 'overlayFingerStrokeRgba') {
      if (typeof v !== 'string' || v.trim() === '') return false
    } else if (typeof v !== 'number' || !Number.isFinite(v)) {
      return false
    }
  }
  return true
}

/**
 * @param {LayoutConfig} L
 */
export function applyLayoutCssVars (L) {
  const root = document.documentElement
  root.style.setProperty('--page-padding', `${L.pagePaddingPx}px`)
  root.style.setProperty('--main-gap', `${L.mainGapPx}px`)
  root.style.setProperty('--sim-stack-min-height', `${L.simStackMinHeightVh}vh`)
  root.style.setProperty('--control-strip-min-height', `${L.controlStripMinHeightPx}px`)
  root.style.setProperty('--iframe-z-index', String(L.iframeZIndex))
  root.style.setProperty('--overlay-z-index', String(L.overlayZIndex))
}

export async function loadConfig () {
  let res
  try {
    res = await fetch('./config.json', { cache: 'no-store' })
  } catch (e) {
    statusDisplay.error(`Could not load config.json (${/** @type {Error} */ (e).message}).`, 'config')
    return null
  }
  if (!res.ok) {
    statusDisplay.error(`config.json HTTP ${res.status}`, 'config')
    return null
  }
  /** @type {unknown} */
  let cfg
  try {
    cfg = await res.json()
  } catch {
    statusDisplay.error('config.json is not valid JSON.', 'config')
    return null
  }
  if (!validateControllerConfig(cfg)) {
    statusDisplay.error('config.json failed validation: see README for required keys (including CONTROLLER_GUID, SIMULATOR_RENDERER_GUID, GEO_LOCATION).', 'config')
    return null
  }
  return cfg
}
