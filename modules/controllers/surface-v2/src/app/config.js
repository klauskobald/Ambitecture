import * as statusDisplay from './statusDisplay.js'
import { parseLayoutCatalog } from '../layout/loadLayoutCatalog.js'

/**
 * @typedef {import('../layout/loadLayoutCatalog.js').LayoutDefinition} LayoutDefinition
 */

/**
 * @typedef {object} AppConfig
 * @property {string} simulatorIframeUrl
 * @property {Record<string, LayoutDefinition>} layoutCatalog
 */

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
  if (o.LAYOUT_MANAGER === undefined) {
    statusDisplay.error('config.json missing LAYOUT_MANAGER.', 'config')
    return null
  }
  const layoutCatalog = parseLayoutCatalog(o.LAYOUT_MANAGER)
  if (!layoutCatalog) return null
  return {
    simulatorIframeUrl: simulatorIframeUrl.trim(),
    layoutCatalog
  }
}
