/**
 * Perform lower strip: sub-navigation (Control / Animate) and two mount regions.
 * Layout/CSS: `.perform-subnav`, `.perform-pane-shell`, `.perform-subpanes`.
 */

import { createPerformControlPanel } from './performControlPanel.js'
import { createPerformAnimatePanel } from './performAnimatePanel.js'

/** @typedef {'control' | 'animate'} PerformSubpaneId */

export class PerformSubnavShell {
  constructor () {
    this._shell = document.createElement('div')
    this._shell.className = 'perform-pane-shell'

    this._subnav = document.createElement('nav')
    this._subnav.className = 'perform-subnav'
    this._subnav.setAttribute('aria-label', 'Perform tools')

    this._subnavToggle = document.createElement('button')
    this._subnavToggle.type = 'button'
    this._subnavToggle.className = 'nav-toggle'
    this._subnavToggle.id = 'perform-subnav-toggle'
    this._subnavToggle.setAttribute('aria-label', 'Toggle section navigation')
    this._subnavToggle.setAttribute('aria-expanded', 'false')
    this._subnavToggle.textContent = '☰'

    const subnavFill = document.createElement('span')
    subnavFill.className = 'perform-subnav-fill'
    subnavFill.setAttribute('aria-hidden', 'true')

    this._linkControl = document.createElement('a')
    this._linkControl.className = 'nav-link nav-link--active'
    this._linkControl.href = '#perform-control'
    this._linkControl.dataset.subpane = 'control'
    this._linkControl.textContent = 'Control'

    this._linkAnimate = document.createElement('a')
    this._linkAnimate.className = 'nav-link'
    this._linkAnimate.href = '#perform-animate'
    this._linkAnimate.dataset.subpane = 'animate'
    this._linkAnimate.textContent = 'Animate'

    this._subnav.appendChild(this._subnavToggle)
    this._subnav.appendChild(subnavFill)
    this._subnav.appendChild(this._linkControl)
    this._subnav.appendChild(this._linkAnimate)

    this._subpanes = document.createElement('div')
    this._subpanes.className = 'perform-subpanes'

    const control = createPerformControlPanel()
    this._controlPanel = control.panel
    this.controlsMount = control.controlsMount

    const animate = createPerformAnimatePanel()
    this._animatePanel = animate.panel
    this.animateMount = this._animatePanel

    this._subpanes.appendChild(this._controlPanel)
    this._subpanes.appendChild(this._animatePanel)

    this._shell.appendChild(this._subnav)
    this._shell.appendChild(this._subpanes)

    /** @type {PerformSubpaneId} */
    this._activeSubpane = 'control'

    this._subnavToggle.addEventListener('click', () => {
      const isOpen = this._subnav.classList.toggle('perform-subnav--open')
      this._subnavToggle.setAttribute('aria-expanded', String(isOpen))
    })

    for (const link of [this._linkControl, this._linkAnimate]) {
      link.addEventListener('click', ev => {
        ev.preventDefault()
        this._subnav.classList.remove('perform-subnav--open')
        this._subnavToggle.setAttribute('aria-expanded', 'false')
        const id = /** @type {PerformSubpaneId} */ (
          link.dataset.subpane === 'animate' ? 'animate' : 'control'
        )
        this.setSubpane(id)
      })
    }
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
    this._linkAnimate.classList.toggle('nav-link--active', id === 'animate')
    this._controlPanel.hidden = id !== 'control'
    this._animatePanel.hidden = id !== 'animate'
  }

  syncSubpaneFromState () {
    this.setSubpane(this._activeSubpane)
  }

  closeMobileNav () {
    this._subnav.classList.remove('perform-subnav--open')
    this._subnavToggle.setAttribute('aria-expanded', 'false')
  }
}
