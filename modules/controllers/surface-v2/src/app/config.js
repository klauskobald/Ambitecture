import * as statusDisplay from './statusDisplay.js'
import { parseLayoutCatalog } from '../layout/loadLayoutCatalog.js'

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
 * @property {number} heightSliderOffsetPx
 * @property {number} heightSliderLengthPx
 * @property {number} heightSliderWidthPx
 * @property {number} heightSliderKnobRadiusPx
 * @property {number} heightSliderEngagedScale
 * @property {number} heightSliderHitPaddingPx
 * @property {number} heightSliderHoldMs
 * @property {string} heightSliderTrackRgba
 * @property {string} heightSliderColorRgba
 * @property {string} heightSliderLabelRgba
 * @property {number} heightSliderLabelFontPx
 * @property {number} animateEditCellWidthPx
 * @property {number} animateEditCellGapPx
 * @property {number} animateEditCellPaddingPx
 * @property {number} animateEditKnobRowHeightPx
 * @property {number} animateEditKnobRowPaddingXPx
 * @property {number} animateEditKnobRowPaddingYPx
 * @property {number} animateEditKnobRowGapPx
 * @property {number} animateEditKnobRowDialSizePx
 */

/**
 * @typedef {import('../layout/loadLayoutCatalog.js').LayoutDefinition} LayoutDefinition
 */

/**
 * @typedef {object} AppConfig
 * @property {string} simulatorIframeUrl
 * @property {string} hubUrl
 * @property {string} geoLocation
 * @property {string} controllerGuid
 * @property {string} simulatorRendererGuid
 * @property {LayoutConfig} layout
 * @property {Record<string, LayoutDefinition>} layoutCatalog
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
  'overlayTrailFadeMs',
  'heightSliderOffsetPx',
  'heightSliderLengthPx',
  'heightSliderWidthPx',
  'heightSliderKnobRadiusPx',
  'heightSliderEngagedScale',
  'heightSliderHitPaddingPx',
  'heightSliderHoldMs',
  'heightSliderTrackRgba',
  'heightSliderColorRgba',
  'heightSliderLabelRgba',
  'heightSliderLabelFontPx',
  'animateEditCellWidthPx',
  'animateEditCellGapPx',
  'animateEditCellPaddingPx',
  'animateEditKnobRowHeightPx',
  'animateEditKnobRowPaddingXPx',
  'animateEditKnobRowPaddingYPx',
  'animateEditKnobRowGapPx',
  'animateEditKnobRowDialSizePx'
])

/**
 * @param {unknown} raw
 * @returns {LayoutConfig | null}
 */
function parseLayoutConfig (raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    statusDisplay.error('config.json LAYOUT must be a map.', 'config')
    return null
  }
  const L = /** @type {Record<string, unknown>} */ (raw)
  for (const key of REQUIRED_LAYOUT_KEYS) {
    if (!(key in L)) {
      statusDisplay.error(`config.json LAYOUT missing ${key}.`, 'config')
      return null
    }
    const v = L[key]
    const isStringKey =
      key === 'overlayFingerFillRgba' ||
      key === 'overlayFingerStrokeRgba' ||
      key === 'heightSliderTrackRgba' ||
      key === 'heightSliderColorRgba' ||
      key === 'heightSliderLabelRgba'
    if (isStringKey) {
      if (typeof v !== 'string' || v.trim() === '') {
        statusDisplay.error(`config.json LAYOUT.${key} must be a string.`, 'config')
        return null
      }
    } else if (typeof v !== 'number' || !Number.isFinite(v)) {
      statusDisplay.error(`config.json LAYOUT.${key} must be a number.`, 'config')
      return null
    }
  }
  return /** @type {LayoutConfig} */ (L)
}

/**
 * @param {LayoutConfig} L
 */
export function applyLayoutCssVars (L) {
  const root = document.documentElement
  root.style.setProperty('--page-padding', `${L.pagePaddingPx}px`)
  root.style.setProperty('--main-gap', `${L.mainGapPx}px`)
  root.style.setProperty('--sim-stack-min-height', `${L.simStackMinHeightVh}vh`)
  root.style.setProperty(
    '--control-strip-min-height',
    `${L.controlStripMinHeightPx}px`
  )
  root.style.setProperty('--iframe-z-index', String(L.iframeZIndex))
  root.style.setProperty('--overlay-z-index', String(L.overlayZIndex))

  root.style.setProperty(
    '--animate-edit-cell-width',
    `${L.animateEditCellWidthPx}px`
  )
  root.style.setProperty('--animate-edit-cell-gap', `${L.animateEditCellGapPx}px`)
  root.style.setProperty(
    '--animate-edit-cell-padding',
    `${L.animateEditCellPaddingPx}px`
  )
  root.style.setProperty(
    '--animate-edit-knobrow-height',
    `${L.animateEditKnobRowHeightPx}px`
  )
  root.style.setProperty(
    '--animate-edit-knobrow-padding-x',
    `${L.animateEditKnobRowPaddingXPx}px`
  )
  root.style.setProperty(
    '--animate-edit-knobrow-padding-y',
    `${L.animateEditKnobRowPaddingYPx}px`
  )
  root.style.setProperty(
    '--animate-edit-knobrow-gap',
    `${L.animateEditKnobRowGapPx}px`
  )
  root.style.setProperty(
    '--animate-edit-knobrow-dial-size',
    `${L.animateEditKnobRowDialSizePx}px`
  )
}

/**
 * @returns {Promise<AppConfig | null>}
 */
export async function loadAppConfig () {
  let res
  try {
    res = await fetch('./config.json', { cache: 'no-store' })
  } catch (e) {
    statusDisplay.error(
      `Could not load config.json (${/** @type {Error} */ (e).message}).`,
      'config'
    )
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
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
    statusDisplay.error('config.json root must be an object.', 'config')
    return null
  }
  const o = /** @type {Record<string, unknown>} */ (cfg)

  const simulatorIframeUrl = o.SIMULATOR_IFRAME_URL
  if (
    typeof simulatorIframeUrl !== 'string' ||
    simulatorIframeUrl.trim() === ''
  ) {
    statusDisplay.error('config.json missing SIMULATOR_IFRAME_URL.', 'config')
    return null
  }

  const hubUrl = o.AMBITECTURE_HUB_URL
  if (typeof hubUrl !== 'string' || hubUrl.trim() === '') {
    statusDisplay.error('config.json missing AMBITECTURE_HUB_URL.', 'config')
    return null
  }

  const geoLocation = o.GEO_LOCATION
  if (typeof geoLocation !== 'string' || geoLocation.trim() === '') {
    statusDisplay.error('config.json missing GEO_LOCATION.', 'config')
    return null
  }

  const controllerGuid = o.CONTROLLER_GUID
  if (typeof controllerGuid !== 'string' || controllerGuid.trim() === '') {
    statusDisplay.error('config.json missing CONTROLLER_GUID.', 'config')
    return null
  }

  const simulatorRendererGuid = o.SIMULATOR_RENDERER_GUID
  if (
    typeof simulatorRendererGuid !== 'string' ||
    simulatorRendererGuid.trim() === ''
  ) {
    statusDisplay.error('config.json missing SIMULATOR_RENDERER_GUID.', 'config')
    return null
  }

  const layout = parseLayoutConfig(o.LAYOUT)
  if (!layout) return null

  if (o.LAYOUT_MANAGER === undefined) {
    statusDisplay.error('config.json missing LAYOUT_MANAGER.', 'config')
    return null
  }
  const layoutCatalog = parseLayoutCatalog(o.LAYOUT_MANAGER)
  if (!layoutCatalog) return null

  return {
    simulatorIframeUrl: simulatorIframeUrl.trim(),
    hubUrl: hubUrl.trim(),
    geoLocation: geoLocation.trim(),
    controllerGuid: controllerGuid.trim(),
    simulatorRendererGuid: simulatorRendererGuid.trim(),
    layout,
    layoutCatalog
  }
}
