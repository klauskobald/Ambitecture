/**
 * Perform lower strip: sub-navigation (Control / Animate) and two mount regions.
 * Layout/CSS: `.perform-subnav`, `.perform-pane-shell`, `.perform-subpanes`.
 */

import { projectGraph } from '../core/projectGraph.js'
import { createPerformControlPanel } from './performControlPanel.js'
import { createPerformAnimatePanel } from './performAnimatePanel.js'
import { createPerformPulsePanel } from './performPulsePanel.js'
import { getResolvedPerformPlugins } from '../plugins/pluginRegistry.js'
import { postThemeToIframe } from '../plugins/themeToIframe.js'
import {
  getPerformIntentFilter,
  setPerformIntentFilter,
  subscribePerformIntentFilter,
  togglePerformIntentFilter
} from '../core/performIntentFilter.js'
import {
  createPulseTapButton,
  mountPulseTapGlobalShortcut
} from '../edit/components/PulseTapButton.js'
import { resolvePulseTapSetupGuid } from '../core/pulseTapResolve.js'

/** @typedef {'control' | 'pulse' | 'animate' | string} PerformSubpaneId */

/**
 * @param {string} baseUrl
 * @param {string | null} filterGuid
 * @returns {string}
 */
function buildPluginIframeSrc (baseUrl, filterGuid) {
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

export class PerformSubnavShell {
  constructor () {
    this._shell = document.createElement('div')
    this._shell.className = 'perform-pane-shell'

    this._subnav = document.createElement('nav')
    this._subnav.className = 'perform-subnav'
    this._subnav.setAttribute('aria-label', 'Perform tools')

    this._tapBtn = createPulseTapButton({
      resolveSetupGuid: resolvePulseTapSetupGuid,
      className: 'perform-pulse-tap-btn perform-subnav-tap'
    })

    this._subnavToggle = document.createElement('button')
    this._subnavToggle.type = 'button'
    this._subnavToggle.className = 'nav-toggle'
    this._subnavToggle.id = 'perform-subnav-toggle'
    this._subnavToggle.setAttribute('aria-label', 'Toggle section navigation')
    this._subnavToggle.setAttribute('aria-expanded', 'false')
    this._subnavToggle.textContent = '☰'

    this._filterChip = document.createElement('button')
    this._filterChip.type = 'button'
    this._filterChip.className = 'perform-subnav-filter'
    this._filterChip.hidden = true
    this._filterChip.setAttribute('aria-label', 'Clear intent filter')
    const filterIcon = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'svg'
    )
    filterIcon.setAttribute('class', 'perform-subnav-filter__icon')
    filterIcon.setAttribute('viewBox', '0 0 16 16')
    filterIcon.setAttribute('aria-hidden', 'true')
    const filterPath = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'path'
    )
    filterPath.setAttribute(
      'd',
      'M2 3h12l-4.5 5.5V13l-3 1.5V8.5z'
    )
    filterPath.setAttribute('fill', 'currentColor')
    filterIcon.appendChild(filterPath)
    this._filterChip.appendChild(filterIcon)
    this._filterChipLabel = document.createElement('span')
    this._filterChipLabel.className = 'perform-subnav-filter__label'
    this._filterChip.appendChild(this._filterChipLabel)

    const subnavFill = document.createElement('span')
    subnavFill.className = 'perform-subnav-fill'
    subnavFill.setAttribute('aria-hidden', 'true')

    this._linkControl = document.createElement('a')
    this._linkControl.className = 'nav-link nav-link--active'
    this._linkControl.href = '#perform-control'
    this._linkControl.dataset.subpane = 'control'
    this._linkControl.textContent = 'Control'

    this._linkPulse = document.createElement('a')
    this._linkPulse.className = 'nav-link'
    this._linkPulse.href = '#perform-pulse'
    this._linkPulse.dataset.subpane = 'pulse'
    this._linkPulse.textContent = 'Pulse'

    this._linkAnimate = document.createElement('a')
    this._linkAnimate.className = 'nav-link'
    this._linkAnimate.href = '#perform-animate'
    this._linkAnimate.dataset.subpane = 'animate'
    this._linkAnimate.textContent = 'Animate'

    this._pluginNavMount = document.createElement('span')
    this._pluginNavMount.className = 'perform-subnav-plugins'
    this._pluginNavMount.setAttribute('aria-hidden', 'false')

    this._subnav.appendChild(this._tapBtn)
    this._subnav.appendChild(this._subnavToggle)
    this._subnav.appendChild(this._filterChip)
    this._subnav.appendChild(subnavFill)
    this._subnav.appendChild(this._linkControl)
    this._subnav.appendChild(this._linkPulse)
    this._subnav.appendChild(this._linkAnimate)
    this._subnav.appendChild(this._pluginNavMount)

    this._subpanes = document.createElement('div')
    this._subpanes.className = 'perform-subpanes'

    const control = createPerformControlPanel()
    this._controlPanel = control.panel
    this.controlsMount = control.controlsMount

    const pulse = createPerformPulsePanel()
    this._pulsePanel = pulse.panel

    const animate = createPerformAnimatePanel()
    this._animatePanel = animate.panel
    this.animateMount = this._animatePanel
    this._animate = animate

    this._filterChip.addEventListener('click', () => {
      setPerformIntentFilter(null)
    })

    subscribePerformIntentFilter(() => {
      this._syncActivePluginIframeFromFilter()
      this._renderFilterChipFromState()
    })
    // Filter chip shows the filtered intent's name; only `intents:def` changes that.
    projectGraph.subscribe(['intents:def'], () => {
      this._renderFilterChipFromState()
    })

    this._subpanes.appendChild(this._controlPanel)
    this._subpanes.appendChild(this._pulsePanel)
    this._subpanes.appendChild(this._animatePanel)

    this._pluginPaneMount = document.createElement('div')
    this._pluginPaneMount.className = 'perform-subpanes-plugins'
    this._subpanes.appendChild(this._pluginPaneMount)

    this._shell.appendChild(this._subnav)
    this._shell.appendChild(this._subpanes)

    /** @type {PerformSubpaneId} */
    this._activeSubpane = 'control'

    /** @type {Map<string, { link: HTMLAnchorElement, panel: HTMLElement, iframe: HTMLIFrameElement | null, offline: HTMLElement, baseIframeUrl: string | null }>} */
    this._pluginSlots = new Map()

    this._subnavToggle.addEventListener('click', () => {
      const isOpen = this._subnav.classList.toggle('perform-subnav--open')
      this._subnavToggle.setAttribute('aria-expanded', String(isOpen))
    })

    for (const link of [this._linkControl, this._linkPulse, this._linkAnimate]) {
      link.addEventListener('click', ev => {
        ev.preventDefault()
        this._subnav.classList.remove('perform-subnav--open')
        this._subnavToggle.setAttribute('aria-expanded', 'false')
        const subpane = link.dataset.subpane
        const id = /** @type {PerformSubpaneId} */ (
          subpane === 'animate' || subpane === 'pulse' ? subpane : 'control'
        )
        this.setSubpane(id)
      })
    }

    mountPulseTapGlobalShortcut(resolvePulseTapSetupGuid)

    this._rebuildPluginSlots()
  }

  /** Re-read project `plugins` + hub discovery; rebuild perform plugin tabs and panels. */
  refreshPerformPlugins () {
    this._rebuildPluginSlots()
  }

  _rebuildPluginSlots () {
    const prevActive = this._activeSubpane
    for (const el of this._pluginNavMount.querySelectorAll('[data-plugin-nav]')) {
      el.remove()
    }
    for (const el of this._pluginPaneMount.querySelectorAll('[data-plugin-panel]')) {
      el.remove()
    }
    this._pluginSlots.clear()

    const plugins = getResolvedPerformPlugins()
    for (const p of plugins) {
      const link = document.createElement('a')
      link.className = 'nav-link'
      link.href = `#perform-plugin-${p.pluginGuid}`
      link.dataset.pluginNav = p.pluginGuid
      link.textContent = p.name
      if (!p.available) link.classList.add('nav-link--muted')
      link.addEventListener('click', ev => {
        ev.preventDefault()
        this._subnav.classList.remove('perform-subnav--open')
        this._subnavToggle.setAttribute('aria-expanded', 'false')
        this.setSubpane(p.pluginGuid)
      })
      this._pluginNavMount.appendChild(link)

      const panel = document.createElement('div')
      panel.className = 'perform-subpane perform-subpane--plugin'
      panel.dataset.pluginPanel = p.pluginGuid
      panel.hidden = true

      const offline = document.createElement('div')
      offline.className = 'perform-plugin-offline'
      offline.textContent =
        'Plugin provider is offline — start the controller or check discovery.'
      offline.hidden = p.available

      let iframe = null
      if (p.available) {
        iframe = document.createElement('iframe')
        iframe.className = 'perform-plugin-iframe'
        iframe.title = p.name
        iframe.sandbox.add('allow-scripts')
        iframe.sandbox.add('allow-same-origin')
        iframe.sandbox.add('allow-modals')
        iframe.addEventListener('load', () => {
          if (iframe) postThemeToIframe(iframe)
        })
      }

      panel.appendChild(offline)
      if (iframe) panel.appendChild(iframe)
      this._pluginPaneMount.appendChild(panel)
      const baseIframeUrl =
        p.available && typeof p.iframeUrl === 'string' && p.iframeUrl
          ? p.iframeUrl
          : null
      this._pluginSlots.set(p.pluginGuid, {
        link,
        panel,
        iframe,
        offline,
        baseIframeUrl
      })
    }

    const stillValid =
      prevActive === 'control' ||
      prevActive === 'pulse' ||
      prevActive === 'animate' ||
      this._pluginSlots.has(prevActive)
    if (!stillValid) this._activeSubpane = 'control'
    this.setSubpane(this._activeSubpane)
  }

  /** @returns {HTMLElement} */
  get element () {
    return this._shell
  }

  /** @returns {PerformSubpaneId} */
  get activeSubpane () {
    return this._activeSubpane
  }

  /**
   * @param {PerformSubpaneId} id
   */
  setSubpane (id) {
    this._activeSubpane = id
    this._linkControl.classList.toggle('nav-link--active', id === 'control')
    this._linkPulse.classList.toggle('nav-link--active', id === 'pulse')
    this._linkAnimate.classList.toggle('nav-link--active', id === 'animate')
    this._controlPanel.hidden = id !== 'control'
    this._pulsePanel.hidden = id !== 'pulse'
    this._animatePanel.hidden = id !== 'animate'

    for (const [guid, slot] of this._pluginSlots) {
      const active = id === guid
      slot.link.classList.toggle('nav-link--active', active)
      slot.panel.hidden = !active
      if (active && slot.iframe && slot.baseIframeUrl) {
        const next = buildPluginIframeSrc(
          slot.baseIframeUrl,
          getPerformIntentFilter()
        )
        if (slot.iframe.src !== next) slot.iframe.src = next
      }
    }
    this._renderFilterChipFromState()
  }

  syncSubpaneFromState () {
    this.setSubpane(this._activeSubpane)
  }

  closeMobileNav () {
    this._subnav.classList.remove('perform-subnav--open')
    this._subnavToggle.setAttribute('aria-expanded', 'false')
  }

  /**
   * Set or clear the perform intent filter. Tapping the same intent twice clears.
   * @param {string | null} guid
   */
  toggleIntentFilter (guid) {
    togglePerformIntentFilter(guid)
  }

  /**
   * @param {PerformSubpaneId} id
   * @returns {boolean}
   */
  isPluginSubpane (id) {
    return (
      id !== 'control' &&
      id !== 'pulse' &&
      id !== 'animate' &&
      this._pluginSlots.has(id)
    )
  }

  _syncActivePluginIframeFromFilter () {
    const id = this._activeSubpane
    if (!this._pluginSlots.has(id)) return
    const slot = this._pluginSlots.get(id)
    if (!slot?.iframe || !slot.baseIframeUrl) return
    const next = buildPluginIframeSrc(
      slot.baseIframeUrl,
      getPerformIntentFilter()
    )
    if (slot.iframe.src !== next) slot.iframe.src = next
  }

  _renderFilterChipFromState () {
    const guid = getPerformIntentFilter()
    if (!guid || this._activeSubpane === 'control' || this._activeSubpane === 'pulse') {
      this._filterChip.hidden = true
      return
    }
    const intent = /** @type {Record<string, unknown> | undefined} */ (
      projectGraph.getIntents().get(guid)
    )
    const name =
      typeof intent?.name === 'string' && intent.name ? intent.name : guid
    this._filterChipLabel.textContent = name
    this._filterChip.setAttribute(
      'aria-label',
      `Clear intent filter (${name})`
    )
    this._filterChip.title = `Filtering by ${name} — tap to clear`
    this._filterChip.hidden = false
  }
}
