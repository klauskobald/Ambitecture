import { projectGraph } from '../core/projectGraph.js'
import { getDiscoveryEntry } from './discoveryRegistry.js'

/**
 * @typedef {object} ResolvedPerformPlugin
 * @property {string} pluginGuid
 * @property {string} name
 * @property {string} providerGuid
 * @property {string} interfaceId
 * @property {string} iframeUrl
 * @property {string} wsUrl
 * @property {boolean} available
 */

/**
 * Perform-pane plugin rows from this controller's project `plugins` YAML, merged with hub discovery.
 * @returns {ResolvedPerformPlugin[]}
 */
export function getResolvedPerformPlugins () {
  const plugins = projectGraph.getControllerPlugins()
  /** @type {ResolvedPerformPlugin[]} */
  const out = []
  for (const p of plugins) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) continue
    const row = /** @type {Record<string, unknown>} */ (p)
    const pluginGuid = typeof row.guid === 'string' ? row.guid : ''
    const provider = row.provider
    const ctx = row.context
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) continue
    const pr = /** @type {Record<string, unknown>} */ (provider)
    const providerGuid = typeof pr.guid === 'string' ? pr.guid : ''
    const interfaceId = typeof pr.interface === 'string' ? pr.interface : ''
    const name = typeof pr.name === 'string' ? pr.name.trim() : ''
    if (!pluginGuid || !providerGuid || !interfaceId || !name) continue
    const c = ctx && typeof ctx === 'object' && !Array.isArray(ctx)
      ? /** @type {Record<string, unknown>} */ (ctx)
      : {}
    const pane = typeof c.pane === 'string' ? c.pane : ''
    const type = typeof c.type === 'string' ? c.type : ''
    if (pane !== 'perform' || type !== 'panel') continue
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
    out.push({
      pluginGuid,
      name,
      providerGuid,
      interfaceId,
      iframeUrl,
      wsUrl,
      available
    })
  }
  return out
}
