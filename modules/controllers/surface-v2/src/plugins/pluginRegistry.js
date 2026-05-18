import { projectGraph } from '../core/projectGraph.js'
import { getDiscoveryEntry } from './discoveryRegistry.js'

/**
 * @typedef {object} ResolvedPlugin
 * @property {string} pluginGuid
 * @property {string} name
 * @property {string} providerGuid
 * @property {string} interfaceId
 * @property {string} iframeUrl
 * @property {string} wsUrl
 * @property {boolean} available
 */

/**
 * @param {Record<string, unknown>} row
 * @returns {ResolvedPlugin | null}
 */
function resolvePluginRow (row) {
  const pluginGuid = typeof row.guid === 'string' ? row.guid : ''
  const provider = row.provider
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) return null
  const pr = /** @type {Record<string, unknown>} */ (provider)
  const providerGuid = typeof pr.guid === 'string' ? pr.guid : ''
  const interfaceId = typeof pr.interface === 'string' ? pr.interface : ''
  const name = typeof pr.name === 'string' ? pr.name.trim() : ''
  if (!pluginGuid || !providerGuid || !interfaceId || !name) return null

  const disc = getDiscoveryEntry(providerGuid)
  const ifaceEntry =
    disc &&
    disc.interfaces &&
    typeof disc.interfaces === 'object' &&
    !Array.isArray(disc.interfaces)
      ? /** @type {Record<string, unknown>} */ (disc.interfaces)[interfaceId]
      : undefined
  const ifaceRec =
    ifaceEntry && typeof ifaceEntry === 'object' && !Array.isArray(ifaceEntry)
      ? /** @type {Record<string, unknown>} */ (ifaceEntry)
      : {}
  const ui = ifaceRec.ui && typeof ifaceRec.ui === 'object' && !Array.isArray(ifaceRec.ui)
    ? /** @type {Record<string, unknown>} */ (ifaceRec.ui)
    : {}
  const ws = ifaceRec.ws && typeof ifaceRec.ws === 'object' && !Array.isArray(ifaceRec.ws)
    ? /** @type {Record<string, unknown>} */ (ifaceRec.ws)
    : {}
  const iframeUrl = typeof ui.url === 'string' ? ui.url : ''
  const wsUrl = typeof ws.url === 'string' ? ws.url : ''
  const available = iframeUrl.length > 0
  return {
    pluginGuid,
    name,
    providerGuid,
    interfaceId,
    iframeUrl,
    wsUrl,
    available
  }
}

/**
 * Layout catalog plugin pane: resolve by project `plugins[].guid` + hub discovery.
 * @param {string} pluginGuid
 * @returns {ResolvedPlugin | null}
 */
export function resolvePluginByGuid (pluginGuid) {
  if (!pluginGuid) return null
  for (const p of projectGraph.getControllerPlugins()) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) continue
    const row = /** @type {Record<string, unknown>} */ (p)
    if (row.guid !== pluginGuid) continue
    return resolvePluginRow(row)
  }
  return null
}

/**
 * @param {string} baseUrl
 * @param {string | null} filterGuid
 * @returns {string}
 */
export function buildPluginIframeSrc (baseUrl, filterGuid) {
  if (!baseUrl) return ''
  let u
  try {
    u = new URL(baseUrl, window.location.href)
  } catch {
    return baseUrl
  }
  if (filterGuid) u.searchParams.set('filter', filterGuid)
  else u.searchParams.delete('filter')
  return u.toString()
}
