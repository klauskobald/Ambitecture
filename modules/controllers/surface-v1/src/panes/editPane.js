import {
  editPolicy,
  noopPolicy,
  getEditFixturesUnlocked,
  setEditFixturesUnlocked
} from '../viewport/interactionPolicies.js'
import { intentGuid } from '../core/stores.js'
import { projectGraph } from '../core/projectGraph.js'
import {
  sendGraphCommand,
  sendSaveProject,
  sendSceneActivate
} from '../core/outboundQueue.js'
import { SelectionManager } from '../viewport/selectionManager.js'
import { ColorPicker } from '../ui/colorPicker.js'
import { hslPalette } from '../ui/palettes/hslPalette.js'
import { toCSSRGB } from '../core/color.js'
import { selectionState } from '../edit/selectionState.js'
import { ActionBar } from '../edit/ActionBar.js'
import { PropertiesDrawer } from '../edit/PropertiesDrawer.js'
import { resolveDescriptorsForClass } from '../core/systemCapabilities.js'
import { warn as modalWarn, pickChoice } from '../core/Modal.js'

/** @param {unknown} value @returns {unknown} */
function cloneDefaultValue (value) {
  if (value === null || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value))
}

/**
 * @param {Record<string, unknown>} target
 * @param {string} dotKey
 * @param {unknown} value
 */
function setAtDotPath (target, dotKey, value) {
  const parts = dotKey.split('.').filter(Boolean)
  if (parts.length === 0) return
  let cursor = target
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i]
    const next = cursor[key]
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      cursor[key] = {}
    }
    cursor = /** @type {Record<string, unknown>} */ (cursor[key])
  }
  cursor[parts[parts.length - 1]] = cloneDefaultValue(value)
}

/** @param {string} intentClass @returns {string} */
function fallbackIntentName (intentClass) {
  return `${intentClass.slice(0, 1).toUpperCase()}${intentClass.slice(1)}`
}

export class EditPane {
  /**
   * @param {import('../viewport/overlayCanvas.js').OverlayCanvas} overlay
   */
  constructor (overlay) {
    this._overlay = overlay
    this._colorPicker = new ColorPicker([hslPalette])
    /** @type {string | null} active mode id */
    this._activeMode = null
    /** @type {Map<string, SelectionManager | null>} lazy-built per mode */
    this._managers = new Map()
    /** @type {(() => void) | null} */
    this._selectionUnsub = null

    this._el = document.createElement('div')
    this._el.className = 'pane edit-pane'
    this._el.hidden = true

    this._modeBar = document.createElement('div')
    this._modeBar.className = 'mode-bar'
    this._el.appendChild(this._modeBar)

    this._fixtureLockBtn = document.createElement('button')
    this._fixtureLockBtn.className = 'btn btn-mode-toggle'
    this._fixtureLockBtn.type = 'button'
    this._fixtureLockBtn.addEventListener('click', () =>
      this._toggleFixtureLock()
    )
    this._modeBar.appendChild(this._fixtureLockBtn)
    this._refreshFixtureLockButton()

    for (const mode of this._modes()) {
      const btn = document.createElement('button')
      btn.className = 'btn btn-mode-toggle'
      btn.textContent = mode.label
      btn.dataset.modeId = mode.id
      btn.addEventListener('click', () => this._toggleMode(mode.id))
      this._modeBar.appendChild(btn)
      this._managers.set(mode.id, null)
    }

    this._actionBar = new ActionBar({
      onModify: () => this._onModifyClick(),
      onCopy: () => {
        void this._onCopyClick()
      },
      onDelete: () => {
        void this._onDeleteClick()
      }
    })
    this._el.appendChild(this._actionBar.buildElement())

    this._drawer = new PropertiesDrawer({
      onAfterCloseSingleModify: () => this._exitSelectModeIfActive()
    })
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.appendChild(this._el)
    this._drawer.mount()
  }

  activate () {
    setEditFixturesUnlocked(false)
    this._refreshFixtureLockButton()
    this._overlay.setPolicy(editPolicy)
    this._overlay.resize()
    this._el.hidden = false

    this._selectionUnsub = selectionState.subscribe(() => {
      this._refreshActionBar()
    })
    this._refreshActionBar()

    this._overlay.setDoubleTapIntentCallback(guid =>
      this._handleDoubleTapIntent(guid)
    )
    this._overlay.setDoubleTapEmptyCallback(detail => {
      void this._onDoubleTapEmpty(detail)
    })
  }

  deactivate () {
    this._exitCurrentMode()
    this._colorPicker.close()
    this._el.hidden = true
    this._overlay.setDoubleTapIntentCallback(null)
    this._overlay.setDoubleTapEmptyCallback(null)

    if (this._selectionUnsub) {
      this._selectionUnsub()
      this._selectionUnsub = null
    }
  }

  // ── Mode registry ─────────────────────────────────────────────────────────────

  _refreshActionBar () {
    this._actionBar.refresh(
      selectionState.getSize(),
      this._activeMode === 'select'
    )
  }

  _toggleFixtureLock () {
    setEditFixturesUnlocked(!getEditFixturesUnlocked())
    this._refreshFixtureLockButton()
  }

  _refreshFixtureLockButton () {
    const unlocked = getEditFixturesUnlocked()
    this._fixtureLockBtn.textContent = unlocked ? '🔓 Fixtures' : '🔒 Fixtures'
    this._fixtureLockBtn.classList.toggle('btn--active', unlocked)
    this._fixtureLockBtn.title = unlocked
      ? 'Fixture dragging enabled'
      : 'Fixture dragging locked'
    this._fixtureLockBtn.setAttribute('aria-pressed', String(unlocked))
  }

  _modes () {
    return [
      {
        id: 'performEnable',
        label: 'Perform Enable',
        buildManager: () => this._buildPerformEnableManager()
      },
      {
        id: 'select',
        label: 'Select',
        buildManager: () => this._buildSelectManager()
      }
    ]
  }

  /** @param {string} modeId */
  _toggleMode (modeId) {
    if (this._activeMode === modeId) {
      this._exitCurrentMode()
    } else {
      this._exitCurrentMode()
      this._enterMode(modeId)
    }
  }

  /** @param {string} modeId */
  _enterMode (modeId) {
    const mode = this._modes().find(m => m.id === modeId)
    if (!mode) return

    let manager = this._managers.get(modeId) ?? null
    if (!manager) {
      manager = mode.buildManager()
      this._managers.set(modeId, manager)
    }

    this._activeMode = modeId
    this._overlay.setPolicy(noopPolicy)
    this._overlay.setSelectionManager(manager)

    const btn = this._modeBar.querySelector(`[data-mode-id="${modeId}"]`)
    btn?.classList.add('btn--active')
    if (modeId === 'performEnable') btn && (btn.textContent = 'Done')
    this._refreshActionBar()
  }

  _exitCurrentMode () {
    if (!this._activeMode) return

    const prev = this._activeMode
    this._activeMode = null
    this._overlay.setPolicy(editPolicy)
    this._overlay.setSelectionManager(null)
    this._colorPicker.close()
    selectionState.clearAll()
    this._drawer.close()

    const btn = this._modeBar.querySelector(`[data-mode-id="${prev}"]`)
    btn?.classList.remove('btn--active')
    const mode = this._modes().find(m => m.id === prev)
    if (btn && mode) btn.textContent = mode.label
    this._refreshActionBar()
  }

  /** Leaves Select mode (toolbar + overlay); no-op if not in Select. */
  _exitSelectModeIfActive () {
    if (this._activeMode === 'select') {
      this._exitCurrentMode()
    }
  }

  // ── Manager builders ──────────────────────────────────────────────────────────

  /** @returns {Iterable<[string, unknown]>} only intents in the active scene */
  _sceneIntentEntries () {
    const active = projectGraph.getActiveSceneName()
    const guids = active ? new Set(projectGraph.getSceneIntents(active)) : null
    return [...projectGraph.getIntents().entries()]
      .filter(([g]) => !guids || guids.has(g))
      .map(([g, intent]) => [g, projectGraph.getEffectiveIntent(g) ?? intent])
  }

  _buildPerformEnableManager () {
    return new SelectionManager({
      getObjects: () => this._sceneIntentEntries(),
      getWorldPos (obj) {
        const i = /** @type {Record<string, unknown>} */ (obj)
        const pos = /** @type {number[] | undefined} */ (i.position)
        if (!pos || pos.length < 3) return null
        return { wx: pos[0], wz: pos[2] }
      },
      onTap (id, obj) {
        const guid = intentGuid(obj)
        const enabled = !projectGraph.getIntentConfig(guid).performEnabled
        const command = projectGraph.patchControllerState(
          `interactionPolicies.performEnabled.${guid}`,
          enabled
        )
        if (!command) return
        sendGraphCommand({
          op: 'patch',
          entityType: 'controller',
          guid: command.guid,
          patch: command.patch,
          persistence: 'runtimeAndDurable'
        })
      },
      drawBubble (ctx, px, py, id, obj) {
        const guid = intentGuid(obj)
        const enabled = !!projectGraph.getIntentConfig(guid).performEnabled
        const R = 24
        ctx.save()
        ctx.beginPath()
        ctx.arc(px, py, R, 0, Math.PI * 2)
        ctx.fillStyle = enabled
          ? 'rgba(85, 170, 255, 0.88)'
          : 'rgba(30, 30, 30, 0.82)'
        ctx.fill()
        ctx.strokeStyle = enabled ? '#5af' : '#444'
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.fillStyle = enabled ? '#fff' : '#777'
        ctx.font = 'bold 11px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(enabled ? 'ON' : 'OFF', px, py)
        ctx.restore()
      }
    })
  }

  _buildSelectManager () {
    return new SelectionManager({
      getObjects: () => this._sceneIntentEntries(),
      getWorldPos (obj) {
        const i = /** @type {Record<string, unknown>} */ (obj)
        const pos = /** @type {number[] | undefined} */ (i.position)
        if (!pos || pos.length < 3) return null
        return { wx: pos[0], wz: pos[2] }
      },
      onTap (_id, obj) {
        const guid = intentGuid(obj)
        selectionState.toggleGuid(guid)
      },
      drawBubble (ctx, px, py, _id, obj) {
        const i = /** @type {Record<string, unknown>} */ (obj)
        const params = /** @type {Record<string, unknown>} */ (i.params ?? {})
        const color = params.color
        const cssColor = color ? toCSSRGB(color) : 'rgb(60, 60, 60)'
        const guid = intentGuid(obj)
        const selected = selectionState.hasGuid(guid)
        const R = 24
        ctx.save()
        ctx.beginPath()
        ctx.arc(px, py, R, 0, Math.PI * 2)
        ctx.fillStyle = cssColor
        ctx.fill()
        ctx.strokeStyle = selected ? '#5af' : 'rgba(100,100,100,0.5)'
        ctx.lineWidth = selected ? 3 : 1.5
        ctx.stroke()
        ctx.restore()
      }
    })
  }

  async _onModifyClick () {
    const selectedGuids = selectionState.getGuids()
    const intentClass = this._selectedIntentClass(selectedGuids)
    if (!intentClass) {
      await modalWarn('Select intents of one class before modifying.')
      return
    }
    const descriptors = resolveDescriptorsForClass(intentClass)
    if (!descriptors) {
      await modalWarn(`No properties configured for intent class "${intentClass}".`)
      return
    }
    this._drawer.open(descriptors, selectionState.getGuids())
  }

  async _onCopyClick () {
    const activeScene = projectGraph.getActiveSceneName()
    if (!activeScene) {
      await modalWarn('Select or create a scene first.')
      return
    }
    const sourceGuids = [...selectionState.getGuids()]
    if (sourceGuids.length === 0) return

    const cryptoApi = globalThis.crypto
    /** @type {Array<{ srcGuid: string, newGuid: string, value: Record<string, unknown> }>} */
    const created = []
    let i = 0
    for (const srcGuid of sourceGuids) {
      const effective = projectGraph.getEffectiveIntent(srcGuid)
      if (!effective) continue
      /** @type {Record<string, unknown>} */
      const raw = JSON.parse(JSON.stringify(effective))
      delete raw.scheduled
      const cls = String(raw.class ?? 'light')
      const suffix =
        cryptoApi?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const newGuid = `${cls}-${suffix}`
      raw.guid = newGuid
      const pos = /** @type {unknown} */ (raw.position)
      if (Array.isArray(pos) && pos.length >= 3) {
        const step = 0.25 * (i + 1)
        raw.position = [
          Number(pos[0]) + step,
          Number(pos[1]),
          Number(pos[2]) + step
        ]
      }
      i += 1

      projectGraph.putIntentRecord(raw)
      projectGraph.appendControllerIntentRef(newGuid)
      projectGraph.addIntentRefToSceneIfMissing(activeScene, newGuid)
      created.push({ srcGuid, newGuid, value: raw })
    }

    if (created.length === 0) {
      await modalWarn('Nothing to copy.')
      return
    }

    for (const { value, newGuid } of created) {
      sendGraphCommand({
        op: 'upsert',
        entityType: 'intent',
        guid: newGuid,
        value,
        persistence: 'runtimeAndDurable'
      })
    }

    const controllerGuid = projectGraph.getControllerGuid()
    if (controllerGuid) {
      /** @type {Record<string, unknown>} */
      const patch = { intents: projectGraph.getControllerIntentRefs() }
      for (const { srcGuid, newGuid } of created) {
        const enabled = !!projectGraph.getIntentConfig(srcGuid).performEnabled
        projectGraph.setIntentConfig(newGuid, 'performEnabled', enabled)
        projectGraph.patchControllerState(
          `interactionPolicies.performEnabled.${newGuid}`,
          enabled
        )
        patch[`interactionPolicies.performEnabled.${newGuid}`] = enabled
      }
      sendGraphCommand({
        op: 'patch',
        entityType: 'controller',
        guid: controllerGuid,
        patch,
        persistence: 'runtimeAndDurable'
      })
    }

    sendSaveProject('scenes', projectGraph.getHubScenesWire())
    if (activeScene === projectGraph.getActiveSceneName()) {
      sendSceneActivate(activeScene)
    }

    this._drawer.close()
    this._exitSelectModeIfActive()
  }

  async _onDeleteClick () {
    const guids = [...selectionState.getGuids()]
    if (guids.length === 0) return

    const choice = await pickChoice('Delete selected intent(s)', [
      { value: 'purge', label: 'Delete completely' },
      { value: 'scene', label: 'Remove from Scene' }
    ])
    if (!choice) return

    if (choice === 'scene') {
      const activeScene = projectGraph.getActiveSceneName()
      if (!activeScene) {
        await modalWarn('Select or create a scene first.')
        return
      }
      let changed = false
      for (const guid of guids) {
        if (projectGraph.removeIntentRefFromScene(activeScene, guid))
          changed = true
      }
      if (!changed) {
        await modalWarn('Selected intent(s) are not in the active scene.')
        return
      }
      sendSaveProject('scenes', projectGraph.getHubScenesWire())
      if (activeScene === projectGraph.getActiveSceneName()) {
        sendSceneActivate(activeScene)
      }
      this._drawer.close()
      this._exitSelectModeIfActive()
      return
    }

    if (choice === 'purge') {
      const toPurge = guids.filter(g => projectGraph.getIntents().has(g))
      if (toPurge.length === 0) {
        await modalWarn('Nothing to delete.')
        return
      }
      /** @type {string[]} */
      const performRemoveKeys = []
      for (const guid of toPurge) {
        performRemoveKeys.push(`interactionPolicies.performEnabled.${guid}`)
        projectGraph.purgeIntentFromProject(guid)
      }
      sendSaveProject('scenes', projectGraph.getHubScenesWire())
      for (const guid of toPurge) {
        sendGraphCommand({
          op: 'remove',
          entityType: 'intent',
          guid,
          persistence: 'runtimeAndDurable'
        })
      }
      const controllerGuid = projectGraph.getControllerGuid()
      if (controllerGuid) {
        sendGraphCommand({
          op: 'patch',
          entityType: 'controller',
          guid: controllerGuid,
          patch: { intents: projectGraph.getControllerIntentRefs() },
          remove: performRemoveKeys,
          persistence: 'runtimeAndDurable'
        })
      }
      const activeScene = projectGraph.getActiveSceneName()
      if (activeScene) sendSceneActivate(activeScene)
      this._drawer.close()
      this._exitSelectModeIfActive()
    }
  }

  /** @param {string} guid */
  _handleDoubleTapIntent (guid) {
    selectionState.clearAll()
    selectionState.toggleGuid(guid)
    void this._onModifyClick()
  }

  /**
   * @param {{ clientX: number, clientY: number }} detail
   */
  async _onDoubleTapEmpty (detail) {
    const activeScene = projectGraph.getActiveSceneName()
    if (!activeScene) {
      await modalWarn('Select or create a scene before adding an intent.')
      return
    }
    const world = this._overlay.worldFromClient(detail.clientX, detail.clientY)
    if (!world) {
      await modalWarn('Tap inside the simulator view to place an intent.')
      return
    }
    const choice = await pickChoice('New intent', [
      { value: 'light', label: 'Light' },
      { value: 'master', label: 'Master' }
    ])
    if (!choice) return

    const descriptors = resolveDescriptorsForClass(choice)
    if (!descriptors) {
      await modalWarn(`No properties configured for intent class "${choice}".`)
      return
    }

    const cryptoApi = globalThis.crypto
    const suffix =
      cryptoApi?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const guid = `${choice}-${suffix}`
    const value = this._createIntentRecord(choice, guid, descriptors, world)

    projectGraph.putIntentRecord(value)
    projectGraph.appendControllerIntentRef(guid)
    projectGraph.toggleSceneIntent(activeScene, guid)

    sendGraphCommand({
      op: 'upsert',
      entityType: 'intent',
      guid,
      value,
      persistence: 'runtimeAndDurable'
    })
    const controllerGuid = projectGraph.getControllerGuid()
    if (controllerGuid) {
      sendGraphCommand({
        op: 'patch',
        entityType: 'controller',
        guid: controllerGuid,
        patch: { intents: projectGraph.getControllerIntentRefs() },
        persistence: 'runtimeAndDurable'
      })
    }
    sendSaveProject('scenes', projectGraph.getScenesData())
    sendSceneActivate(activeScene)

    selectionState.clearAll()
    selectionState.toggleGuid(guid)
    void this._onModifyClick()
  }

  /**
   * @param {Set<string>} guids
   * @returns {string | null}
   */
  _selectedIntentClass (guids) {
    const classes = new Set()
    for (const guid of guids) {
      const intent = projectGraph.getEffectiveIntent(guid) ?? projectGraph.getIntents().get(guid)
      if (!intent) continue
      const cls = /** @type {Record<string, unknown>} */ (intent).class
      classes.add(typeof cls === 'string' && cls.length > 0 ? cls : 'light')
    }
    if (classes.size !== 1) return null
    return [...classes][0]
  }

  /**
   * @param {string} intentClass
   * @param {string} guid
   * @param {unknown[]} descriptors
   * @param {{ wx: number, wy: number, wz: number }} world
   * @returns {Record<string, unknown>}
   */
  _createIntentRecord (intentClass, guid, descriptors, world) {
    /** @type {Record<string, unknown>} */
    const value = {
      guid,
      class: intentClass,
      position: [world.wx, world.wy, world.wz],
      params: {}
    }

    for (const descriptor of descriptors) {
      const d = /** @type {Record<string, unknown>} */ (descriptor)
      const dotKey = typeof d.dotKey === 'string' ? d.dotKey : ''
      if (!dotKey || !d.isMandatory || d.defaultValue === undefined) continue
      setAtDotPath(value, dotKey, d.defaultValue)
    }

    if (value.name === undefined) value.name = fallbackIntentName(intentClass)
    if (intentClass === 'master' && value.radius === undefined) value.radius = 0
    return value
  }
}
