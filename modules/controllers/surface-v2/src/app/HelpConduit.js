import { hubProbe } from '../core/HubProbe.js'

/**
 * Domain glue between the (domain-free) help system and the hub. Each help
 * function name authored in `help.json` as `${display:fnName(args)}` maps to a
 * method here; most resolve to a `system:probe` query so the panel shows live
 * hub state instead of hardcoded data. Expected to grow one case per function.
 *
 * @implements {import('../core/help/HelpManager.js').HelpConduit}
 */
export class HelpConduit {
  /** @param {{ probe: (query: string, args?: unknown) => Promise<unknown> }} [probe] */
  constructor (probe = hubProbe) {
    this._probe = probe
  }

  /**
   * @param {string} name
   * @param {string} _args
   * @returns {unknown | Promise<unknown>}
   */
  callFunction (name, _args) {
    switch (name) {
      case 'getRendererList':
        return this._getRendererList()
      default:
        return null
    }
  }

  /**
   * Probe connected renderers (`{ type, guid }`) and shape them for the help
   * `listView` plugin: `entity` is the renderer type, `name` joins type + guid
   * so the panel shows e.g. "dmx (a1b2c3)".
   * @returns {Promise<Array<{ name: string, entity: string }>>}
   */
  async _getRendererList () {
    const renderers = await this._probe.probe('connectedRenderers')
    if (!Array.isArray(renderers)) return []
    return renderers
      .map(r => /** @type {Record<string, unknown>} */ (r))
      .filter(r => typeof r.type === 'string' && typeof r.guid === 'string')
      .map(r => ({
        entity: String(r.type),
        name: `${String(r.type).toUpperCase()} (${String(r.guid)})`
      }))
  }
}
