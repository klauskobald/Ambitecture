import { confirm as modalConfirm, prompt as modalPrompt } from '../core/Modal.js'
import { intentName } from '../core/stores.js'
import { projectGraph } from '../core/projectGraph.js'
import { sendActionInputCommand, sendGraphCommand, sendSceneActivate, sendSaveProject } from '../core/outboundQueue.js'

export class ScenesPane {
  constructor () {
    this._el = document.createElement('div')
    this._el.className = 'pane scenes-pane'
    this._el.hidden = true

    this._layout = document.createElement('div')
    this._layout.className = 'scenes-layout'

    this._listEl = document.createElement('ul')
    this._listEl.className = 'scene-list'

    this._detailEl = document.createElement('div')
    this._detailEl.className = 'scene-detail'

    this._intentsSection = document.createElement('section')
    this._intentsSection.className = 'scene-section'
    this._intentsTitle = document.createElement('h2')
    this._intentsTitle.className = 'scene-section-title'
    this._intentsTitle.textContent = 'Intents'
    this._intentsBody = document.createElement('div')
    this._intentsBody.className = 'scene-intents'
    this._intentsSection.appendChild(this._intentsTitle)
    this._intentsSection.appendChild(this._intentsBody)

    this._performSection = document.createElement('section')
    this._performSection.className = 'scene-section scene-section--perform'
    this._performTitle = document.createElement('h2')
    this._performTitle.className = 'scene-section-title'
    this._performTitle.textContent = 'Perform'
    this._performBody = document.createElement('div')
    this._performBody.className = 'scene-perform'
    this._performSection.appendChild(this._performTitle)
    this._performSection.appendChild(this._performBody)

    this._actionsSection = document.createElement('section')
    this._actionsSection.className = 'scene-section scene-section--actions'
    this._actionsBody = document.createElement('div')
    this._actionsBody.className = 'scene-actions'

    this._renameBtn = document.createElement('button')
    this._renameBtn.className = 'btn'
    this._renameBtn.textContent = 'Rename'
    this._renameBtn.addEventListener('click', () => this._onRenameClick())

    this._copyBtn = document.createElement('button')
    this._copyBtn.className = 'btn'
    this._copyBtn.textContent = 'Copy'
    this._copyBtn.addEventListener('click', () => this._onCopyClick())

    this._deleteBtn = document.createElement('button')
    this._deleteBtn.className = 'btn'
    this._deleteBtn.textContent = 'Delete'
    this._deleteBtn.addEventListener('click', () => this._onDeleteClick())

    this._actionsBody.appendChild(this._renameBtn)
    this._actionsBody.appendChild(this._copyBtn)
    this._actionsBody.appendChild(this._deleteBtn)
    this._actionsSection.appendChild(this._actionsBody)

    this._detailEl.appendChild(this._intentsSection)
    this._detailEl.appendChild(this._performSection)
    this._detailEl.appendChild(this._actionsSection)

    this._layout.appendChild(this._listEl)
    this._layout.appendChild(this._detailEl)
    this._el.appendChild(this._layout)

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

    this._ensureActiveScene()
    this._render()

    this._unsubscribe = projectGraph.subscribe(() => {
      this._ensureActiveScene()
      this._render()
    })
  }

  deactivate () {
    const simArea = document.getElementById('sim-area')
    if (simArea) simArea.hidden = false
    this._el.hidden = true
    this._unsubscribe?.()
    this._unsubscribe = null
  }

  _render () {
    const activeScene = projectGraph.getActiveSceneName()
    this._renderSceneList(activeScene)
    this._renderIntentToggles(this._intentsBody, activeScene)
    this._renderPerformControls(activeScene)
    this._renderActions(activeScene)
  }

  _ensureActiveScene () {
    const scenes = projectGraph.getScenes()
    const active = projectGraph.getActiveSceneName()
    if (active && scenes.includes(active)) return
    const fallback = scenes[0] ?? null
    if (fallback) {
      projectGraph.setActiveScene(fallback)
      sendSceneActivate(fallback)
    }
  }

  /** @param {string | null} activeScene */
  _renderSceneList (activeScene) {
    this._listEl.innerHTML = ''
    for (const name of projectGraph.getScenes()) {
      const li = document.createElement('li')
      li.className = 'scene-list-item'
      if (name === activeScene) li.classList.add('scene-list-item--active')
      li.textContent = name
      li.addEventListener('click', () => {
        projectGraph.setActiveScene(name)
        sendSceneActivate(name)
      })
      this._listEl.appendChild(li)
    }
  }

  /** @param {string | null} activeScene */
  _renderActions (activeScene) {
    const sceneCount = projectGraph.getScenes().length
    const hasActive = Boolean(activeScene)
    this._renameBtn.disabled = !hasActive
    this._copyBtn.disabled = !hasActive
    this._deleteBtn.disabled = !hasActive || sceneCount <= 1
  }

  /** @param {string | null} activeScene */
  _renderPerformControls (activeScene) {
    this._performBody.innerHTML = ''
    if (!activeScene) return

    const sceneGuid = projectGraph.getSceneGuid(activeScene)
    if (!sceneGuid) return

    const input = projectGraph.getSceneButtonInput(sceneGuid)
    const action = projectGraph.getSceneAction(sceneGuid)
    const isActive = Boolean(input?.action && action)
    const label = String(input?.name ?? activeScene)

    const row = document.createElement('div')
    row.className = 'scene-perform-row' + (isActive ? ' scene-perform-row--active' : '')

    const button = document.createElement('button')
    button.className = 'intent-toggle scene-perform-button' + (isActive ? ' intent-toggle--enabled' : '')
    button.textContent = 'Button'
    button.addEventListener('click', () => {
      sendActionInputCommand({
        command: isActive ? 'disableSceneButton' : 'ensureSceneButton',
        sceneGuid
      })
    })

    const labelButton = document.createElement('button')
    labelButton.className = 'btn scene-perform-label'
    labelButton.textContent = label
    labelButton.disabled = !isActive || !input?.guid
    labelButton.addEventListener('click', () => this._onPerformLabelClick(input))

    row.appendChild(button)
    row.appendChild(labelButton)
    this._performBody.appendChild(row)
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
        sendSaveProject('scenes', toHubScenes(projectGraph.getScenesData()))
        if (activeScene === projectGraph.getActiveSceneName()) {
          sendSceneActivate(activeScene)
        }
      })
      container.appendChild(btn)
    }
  }

  async _onRenameClick () {
    const active = projectGraph.getActiveSceneName()
    if (!active) return
    const values = await modalPrompt('', [
      { label: 'Name', key: 'name', value: active, placeholder: 'scene name' },
    ], { submit: 'Rename' })
    const nextName = values?.name?.trim()
    if (!nextName || nextName === active) return
    const scenes = projectGraph.getScenesData()
    if (scenes.some(s => s.name === nextName)) return
    const target = scenes.find(s => s.name === active)
    if (!target) return
    target.name = nextName
    projectGraph.setActiveScene(nextName)
    sendSaveProject('scenes', toHubScenes(scenes))
    sendSceneActivate(nextName)
  }

  /** @param {Record<string, unknown> | null} input */
  async _onPerformLabelClick (input) {
    const inputGuid = typeof input?.guid === 'string' ? input.guid : ''
    if (!inputGuid) return
    const values = await modalPrompt('', [
      { label: 'Name', key: 'name', value: String(input?.name ?? ''), placeholder: 'input name' },
    ], { submit: 'Rename' })
    const nextName = values?.name?.trim()
    if (!nextName || nextName === input?.name) return
    sendActionInputCommand({
      command: 'renameInput',
      inputGuid,
      name: nextName
    })
  }

  async _onCopyClick () {
    const active = projectGraph.getActiveSceneName()
    if (!active) return
    const values = await modalPrompt('', [
      { label: 'Name', key: 'name', value: `${active} copy`, placeholder: 'scene name' },
    ], { submit: 'Copy' })
    const nextName = values?.name?.trim()
    if (!nextName) return
    const scenes = projectGraph.getScenesData()
    if (scenes.some(s => s.name === nextName)) return
    const source = scenes.find(s => s.name === active)
    if (!source) return
    scenes.push({ guid: newGuid('scene'), name: nextName, intents: source.intents.map(cloneSceneIntentRef) })
    projectGraph.setActiveScene(nextName)
    sendSaveProject('scenes', toHubScenes(scenes))
    sendSceneActivate(nextName)
  }

  async _onDeleteClick () {
    const active = projectGraph.getActiveSceneName()
    if (!active) return
    const scenes = projectGraph.getScenesData()
    if (scenes.length <= 1) return
    const ok = await modalConfirm(
      `Remove scene "${active}"?`,
      { yes: 'Remove', no: 'Cancel' },
    )
    if (!ok) return
    const idx = scenes.findIndex(s => s.name === active)
    if (idx === -1) return
    const removedGuid = scenes[idx]?.guid
    scenes.splice(idx, 1)
    const nextActive = scenes[Math.max(0, idx - 1)]?.name ?? scenes[0]?.name ?? null
    if (nextActive) {
      projectGraph.setActiveScene(nextActive)
      sendSceneActivate(nextActive)
    }
    if (removedGuid) {
      sendGraphCommand({
        op: 'remove',
        entityType: 'scene',
        guid: removedGuid,
        persistence: 'runtimeAndDurable'
      })
    } else {
      sendSaveProject('scenes', toHubScenes(scenes))
    }
  }
}

/**
 * @param {Array<{ guid?: string, name: string, intents: Array<{ guid: string, overlay?: Record<string, unknown> }> }>} scenes
 * @returns {Array<{ guid: string, name: string, intents: Array<{ guid: string, overlay?: Record<string, unknown> }> }>}
 */
function toHubScenes (scenes) {
  return scenes.map(s => ({
    guid: s.guid || newGuid('scene'),
    name: s.name,
    intents: s.intents.map(cloneSceneIntentRef),
  }))
}

/**
 * @param {{ guid: string, overlay?: Record<string, unknown> }} ref
 * @returns {{ guid: string, overlay?: Record<string, unknown> }}
 */
function cloneSceneIntentRef (ref) {
  return ref.overlay ? { guid: ref.guid, overlay: JSON.parse(JSON.stringify(ref.overlay)) } : { guid: ref.guid }
}

/** @param {string} prefix */
function newGuid (prefix) {
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.randomUUID) return `${prefix}-${cryptoApi.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
