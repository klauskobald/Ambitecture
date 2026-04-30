import { ConfigSectionEditor } from '../core/ConfigSectionEditor.js'
import { intentName } from '../core/stores.js'
import { projectGraph } from '../core/projectGraph.js'
import { sendSceneActivate, sendSceneUpdate } from '../core/outboundQueue.js'

export class ScenesPane {
  constructor () {
    this._el = document.createElement('div')
    this._el.className = 'pane scenes-pane'
    this._el.hidden = true

    this._editor = new ConfigSectionEditor({
      title: 'Scenes',
      getItems: () => projectGraph.getScenes(),
      onActivate: (name) => {
        projectGraph.setActiveScene(name)
        sendSceneActivate(name)
      },
      onAdd: (name) => {
        const active = projectGraph.getActiveSceneName()
        projectGraph.addScene(name, active)
        sendSceneUpdate(projectGraph.getScenesData())
      },
      onRemove: (name) => {
        projectGraph.removeScene(name)
        sendSceneUpdate(projectGraph.getScenesData())
      },
      renderSection: (container, activeScene) => {
        this._renderIntentToggles(container, activeScene)
      },
    })
    this._editor.mount(this._el)

    /** @type {(() => void) | null} */
    this._unsubscribe = null
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.appendChild(this._el)
  }

  activate () {
    const simArea = document.getElementById('sim-area')
    if (simArea) simArea.hidden = true
    this._el.hidden = false

    const active = projectGraph.getActiveSceneName()
    const scenes = projectGraph.getScenes()
    this._editor.refresh()
    if (active && scenes.includes(active)) {
      this._editor.setActive(active)
    } else if (scenes.length > 0) {
      this._editor.setActive(scenes[0])
    }

    this._unsubscribe = projectGraph.subscribe(() => this._editor.refresh())
  }

  deactivate () {
    const simArea = document.getElementById('sim-area')
    if (simArea) simArea.hidden = false
    this._el.hidden = true
    this._unsubscribe?.()
    this._unsubscribe = null
  }

  // ── Intent toggles ────────────────────────────────────────────────────────────

  /**
   * @param {HTMLElement} container
   * @param {string | null} activeScene
   */
  _renderIntentToggles (container, activeScene) {
    container.innerHTML = ''
    if (!activeScene) return

    const sceneGuids = new Set(projectGraph.getSceneIntents(activeScene))
    for (const [guid, intent] of projectGraph.getIntents()) {
      const enabled = sceneGuids.has(guid)
      const btn = document.createElement('button')
      btn.className = 'intent-toggle' + (enabled ? ' intent-toggle--enabled' : '')
      btn.textContent = intentName(intent) || guid
      btn.addEventListener('click', () => {
        projectGraph.toggleSceneIntent(activeScene, guid)
        sendSceneUpdate(projectGraph.getScenesData())
      })
      container.appendChild(btn)
    }
  }
}
