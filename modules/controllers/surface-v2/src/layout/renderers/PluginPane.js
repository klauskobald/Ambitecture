import { projectGraph } from '../../core/projectGraph.js'
import {
  getPerformIntentFilter,
  subscribePerformIntentFilter,
  togglePerformIntentFilter
} from '../../core/performIntentFilter.js'
import {
  buildPluginIframeSrc,
  resolvePluginByGuid
} from '../../plugins/pluginRegistry.js'
import { postThemeToIframe } from '../../plugins/themeToIframe.js'
import { getControllerSurface } from '../../stage/stageCommon.js'

export class PluginPane {
  /** @param {string | undefined} [pluginGuid] */
  static getButtonLabel (pluginGuid) {
    const guid = pluginGuid ?? ''
    const resolved = resolvePluginByGuid(guid)
    return resolved?.name ?? guid
  }

  /**
   * @param {string} pluginGuid project `plugins[].guid` (layout arg after `plugin:`)
   */
  constructor (pluginGuid) {
    this._pluginGuid = pluginGuid
    /** @type {HTMLDivElement | null} */
    this._panel = null
    /** @type {HTMLDivElement | null} */
    this._offline = null
    /** @type {HTMLIFrameElement | null} */
    this._iframe = null
    /** @type {string | null} */
    this._baseIframeUrl = null
    /** @type {(() => void) | null} */
    this._unsubscribeFilter = null
    /** @type {(() => void) | null} */
    this._unsubscribeDiscovery = null
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.classList.add('layout-perform-pane', 'layout-plugin-pane')

    const panel = document.createElement('div')
    panel.className = 'perform-subpane perform-subpane--plugin'

    const offline = document.createElement('div')
    offline.className = 'perform-plugin-offline'
    offline.textContent =
      'Plugin provider is offline — start the controller or check discovery.'

    panel.appendChild(offline)
    container.appendChild(panel)
    this._panel = panel
    this._offline = offline
    this._syncFromProject()
  }

  activate () {
    this._syncIframeSrc()
    this._unsubscribeFilter = subscribePerformIntentFilter(() => {
      this._syncIframeSrc()
    })
    this._unsubscribeDiscovery = projectGraph.subscribe(
      ['discovery', 'controller'],
      () => this._syncFromProject()
    )

    const overlay = getControllerSurface()?.getOverlay()
    if (overlay) {
      overlay.setSingleTapIntentCallback(guid => {
        togglePerformIntentFilter(guid)
      })
    }
  }

  deactivate () {
    this._unsubscribeFilter?.()
    this._unsubscribeFilter = null
    this._unsubscribeDiscovery?.()
    this._unsubscribeDiscovery = null
    const overlay = getControllerSurface()?.getOverlay()
    overlay?.setSingleTapIntentCallback(null)
  }

  _syncFromProject () {
    const resolved = resolvePluginByGuid(this._pluginGuid)
    if (!this._panel || !this._offline) return

    if (this._iframe) {
      this._iframe.remove()
      this._iframe = null
    }
    this._baseIframeUrl = null

    if (!resolved) {
      this._offline.hidden = false
      this._offline.textContent = `Unknown plugin "${this._pluginGuid}" in project.`
      return
    }

    if (!resolved.available) {
      this._offline.hidden = false
      this._offline.textContent =
        'Plugin provider is offline — start the controller or check discovery.'
      return
    }

    this._offline.hidden = true
    this._baseIframeUrl = resolved.iframeUrl

    const iframe = document.createElement('iframe')
    iframe.className = 'perform-plugin-iframe'
    iframe.title = resolved.name
    iframe.sandbox.add('allow-scripts')
    iframe.sandbox.add('allow-same-origin')
    iframe.sandbox.add('allow-modals')
    iframe.addEventListener('load', () => {
      postThemeToIframe(iframe)
    })
    this._panel.appendChild(iframe)
    this._iframe = iframe
    this._syncIframeSrc()
  }

  _syncIframeSrc () {
    if (!this._iframe || !this._baseIframeUrl) return
    const next = buildPluginIframeSrc(
      this._baseIframeUrl,
      getPerformIntentFilter()
    )
    if (this._iframe.src !== next) this._iframe.src = next
  }
}
