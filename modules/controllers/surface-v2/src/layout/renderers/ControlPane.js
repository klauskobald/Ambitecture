import { createPerformControlPanel } from '../../perform/performControlPanel.js'
import { PerformControlHost } from '../../perform/performControlHost.js'
import { projectGraph } from '../../core/projectGraph.js'
import { subscribeAnimationPlayState } from '../../core/animationPlayRegistry.js'
import { subscribeSceneAutoResetOnLoadChange } from '../../perform/sceneAutoResetPreference.js'

export class ControlPane {
  constructor () {
    this._host = new PerformControlHost()
    /** @type {HTMLElement | null} */
    this._controlsMount = null
    /** @type {(() => void) | null} */
    this._unsubscribe = null
    /** @type {(() => void) | null} */
    this._unsubscribeAnimationPlayState = null
    /** @type {(() => void) | null} */
    this._unsubscribeSceneAutoReset = null
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.classList.add('layout-perform-pane')
    const { panel, controlsMount } = createPerformControlPanel()
    panel.classList.add('perform-subpane--control-root')
    container.appendChild(panel)
    this._controlsMount = controlsMount
  }

  activate () {
    this._render()
    this._unsubscribe = projectGraph.subscribe(
      ['inputs', 'actions', 'scenes', 'controller', 'discovery'],
      () => this._render()
    )
    this._unsubscribeAnimationPlayState = subscribeAnimationPlayState(() => {
      this._render()
    })
    this._unsubscribeSceneAutoReset = subscribeSceneAutoResetOnLoadChange(() => {
      this._render()
    })
  }

  deactivate () {
    this._unsubscribe?.()
    this._unsubscribe = null
    this._unsubscribeAnimationPlayState?.()
    this._unsubscribeAnimationPlayState = null
    this._unsubscribeSceneAutoReset?.()
    this._unsubscribeSceneAutoReset = null
  }

  _render () {
    if (!this._controlsMount) return
    this._controlsMount.replaceChildren()
    this._host.render(this._controlsMount)
  }
}
