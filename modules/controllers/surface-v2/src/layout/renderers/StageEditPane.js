import {
  editPolicy,
  noopPolicy,
  getEditFixturesUnlocked,
  setEditFixturesUnlocked
} from '../../viewport/interactionPolicies.js'
import { attachStageTo, detachStage, getViewport } from '../../stage/stageCommon.js'
import { getStageOverlay } from '../../stage/stageOverlayHost.js'
import {
  setEditMode,
  setPerformMode,
  setEditDoubleTapHandlers,
  clearEditDoubleTapHandlers,
  setStageEditExitSelectModeHandler
} from '../../stage/stageOverlayCoordinator.js'
import { IntentParamsHost } from '../../stage/IntentParamsHost.js'
import { FixtureParamsHost } from '../../edit/fixture/FixtureParamsHost.js'
import { selectionState } from '../../edit/selectionState.js'
import { projectGraph } from '../../core/projectGraph.js'
import { intentGuid } from '../../core/stores.js'
import { toCSSRGB } from '../../core/color.js'
import { SelectionManager } from '../../viewport/selectionManager.js'
import { warn as modalWarn, openModalCard, pickChoice } from '../../core/Modal.js'
import {
  sendGraphCommand,
  sendSaveProject,
  sendSceneActivate,
  queuePhysicsEnabled
} from '../../core/outboundQueue.js'
import {
  ArraySorter,
  DEFAULT_PERFORM_INPUT_SORT_KEY
} from '../../core/arraySorter.js'
import { collectPerformButtonInputs } from '../../core/performButtonInputs.js'
import { clientToWorldViaSimCanvas } from '../../viewport/spatialMath.js'
import { showHelp } from '../../app/actionHelp.js'
import { resolveDescriptorsForClass } from '../../core/systemCapabilities.js'
import { cloneAndSetAtDotPath } from '../../core/dotPath.js'

/** @param {unknown} value @returns {unknown} */
function cloneDefaultValue (value) {
  if (value === null || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value))
}

/** @type {IntentParamsHost | null} */
let sharedParamsHost = null

function getParamsHost () {
  if (!sharedParamsHost) sharedParamsHost = new IntentParamsHost()
  return sharedParamsHost
}

export function rebindIntentParamsHost () {
  getParamsHost().rebindHost()
}

/** @type {FixtureParamsHost | null} */
let sharedFixtureParamsHost = null

function getFixtureParamsHost () {
  if (!sharedFixtureParamsHost) sharedFixtureParamsHost = new FixtureParamsHost()
  return sharedFixtureParamsHost
}

export function rebindFixtureParamsHost () {
  getFixtureParamsHost().rebindHost()
}

export class StageEditPane {
  constructor () {
    /** @type {string | null} */
    this._activeMode = null
    /** @type {Map<string, SelectionManager | null>} */
    this._managers = new Map()
    /** @type {(() => void) | null} */
    this._selectionUnsub = null
    /** @type {HTMLElement | null} */
    this._modeBar = null
    /** @type {HTMLElement | null} */
    this._stageSlot = null
    /** @type {HTMLButtonElement | null} */
    this._physicsBtn = null
    this._physicsOn = false
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.classList.add('layout-stage-edit-pane')
    container.replaceChildren()

    const slot = document.createElement('div')
    slot.className = 'layout-stage-slot'
    this._stageSlot = slot

    const modeBar = document.createElement('div')
    modeBar.className = 'layout-stage-edit-mode-bar'
    this._modeBar = modeBar
    this._buildModeBar(modeBar)

    container.appendChild(slot)
    container.appendChild(modeBar)
  }

  /** @param {HTMLElement} modeBar */
  _buildModeBar (modeBar) {
    modeBar.replaceChildren()

    const bar = document.createElement('div')
    bar.className = 'mode-bar'

    this._fixtureLockBtn = document.createElement('button')
    this._fixtureLockBtn.className = 'btn btn-mode-toggle'
    this._fixtureLockBtn.type = 'button'
    this._fixtureLockBtn.dataset.help = 'stage.edit.fixtureLock'
    this._fixtureLockBtn.addEventListener('click', () =>
      this._toggleFixtureLock()
    )
    bar.appendChild(this._fixtureLockBtn)
    this._refreshFixtureLockButton()

    for (const mode of this._modes()) {
      const btn = document.createElement('button')
      btn.className = 'btn btn-mode-toggle'
      btn.textContent = mode.label
      btn.dataset.modeId = mode.id
      btn.dataset.help = `stage.edit.${mode.id}`
      btn.addEventListener('click', () => this._toggleMode(mode.id))
      bar.appendChild(btn)
      this._managers.set(mode.id, null)
    }

    this._performSortBtn = document.createElement('button')
    this._performSortBtn.type = 'button'
    this._performSortBtn.className = 'btn btn-mode-toggle'
    this._performSortBtn.textContent = 'Perform sort'
    this._performSortBtn.dataset.help = 'stage.edit.performSort'
    this._performSortBtn.addEventListener(
      'click',
      () => void this._onPerformSortClick()
    )
    const selectModeBtn = bar.querySelector('[data-mode-id="select"]')
    if (selectModeBtn) {
      bar.insertBefore(this._performSortBtn, selectModeBtn)
    } else {
      bar.appendChild(this._performSortBtn)
    }

    this._physicsBtn = document.createElement('button')
    this._physicsBtn.type = 'button'
    this._physicsBtn.className = 'btn btn-mode-toggle'
    this._physicsBtn.textContent = 'Physics'
    this._physicsBtn.dataset.help = 'stage.edit.physics'
    this._refreshPhysicsButton()
    this._physicsBtn.addEventListener('click', () => this._togglePhysics())
    bar.appendChild(this._physicsBtn)

    modeBar.appendChild(bar)
  }

  _refreshPhysicsButton () {
    if (!this._physicsBtn) return
    this._physicsBtn.classList.toggle('btn--active', this._physicsOn)
  }

  _togglePhysics () {
    this._physicsOn = !this._physicsOn
    this._refreshPhysicsButton()
    queuePhysicsEnabled(this._physicsOn)
  }

  activate () {
    if (this._stageSlot) attachStageTo(this._stageSlot)

    setEditFixturesUnlocked(false)
    this._refreshFixtureLockButton()
    this._physicsOn = false
    this._refreshPhysicsButton()
    queuePhysicsEnabled(false)
    setEditMode()
    setEditDoubleTapHandlers(
      guid => {
        getFixtureParamsHost().close()
        getParamsHost().openForIntentGuid(guid)
      },
      detail => {
        getFixtureParamsHost().close()
        void this._onDoubleTapEmptyStage(detail)
      },
      fixtureId => this._openFixtureEditor(fixtureId)
    )
    setStageEditExitSelectModeHandler(() => this._exitSelectModeIfActive())

    const overlay = getStageOverlay()
    overlay?.resize()
    overlay?.markRenderActivity()

    this._selectionUnsub = selectionState.subscribe(() => {
      overlay?.markRenderActivity()
    })
  }

  deactivate () {
    this._exitCurrentMode()
    clearEditDoubleTapHandlers()
    setStageEditExitSelectModeHandler(null)
    getParamsHost().close()
    getFixtureParamsHost().close()
    queuePhysicsEnabled(true)
    setPerformMode()
    if (this._selectionUnsub) {
      this._selectionUnsub()
      this._selectionUnsub = null
    }
    detachStage()
  }

  /**
   * Resolve a fixture id (`zoneName::fixtureName`) from the overlay to its stable guid and open
   * the fixture editor, closing the intent editor (shared overlay region).
   * @param {string} fixtureId
   */
  _openFixtureEditor (fixtureId) {
    const fixture = projectGraph.getFixtures().get(fixtureId)
    const guid =
      fixture && typeof fixture === 'object'
        ? String(/** @type {Record<string, unknown>} */ (fixture).guid ?? '')
        : ''
    if (!guid) return
    getParamsHost().close()
    void getFixtureParamsHost().openForFixtureGuid(guid)
  }

  _toggleFixtureLock () {
    setEditFixturesUnlocked(!getEditFixturesUnlocked())
    this._refreshFixtureLockButton()
    getStageOverlay()?.markRenderActivity()
  }

  /**
   * @param {{ clientX: number, clientY: number }} detail
   */
  async _onDoubleTapEmptyStage (detail) {
    const activeScene = projectGraph.getActiveSceneName()
    if (!activeScene) {
      void modalWarn('Select or create a scene before adding an intent.')
      return
    }

    const spatial = projectGraph.getSpatial()
    const viewport = getViewport()
    const simRect = viewport?.getSimCanvasRect() ?? null
    if (!spatial || !simRect) return

    const m = clientToWorldViaSimCanvas(
      detail.clientX,
      detail.clientY,
      spatial,
      simRect
    )
    if (!m) {
      void modalWarn('Tap inside the simulator view to place an intent.')
      return
    }

    showHelp('stage.edit.createIntent')
    const choice = await pickChoice('New intent', [
      { value: 'light', label: 'Light' },
      { value: 'master', label: 'Master' },
      { value: 'target', label: 'Target' }
    ])
    if (!choice || !['light', 'master', 'target'].includes(choice)) return

    const descriptors = resolveDescriptorsForClass(choice)
    if (!descriptors || descriptors.length === 0) {
      void modalWarn(
        `No properties configured for intent class "${choice}" (systemCapabilities).`
      )
      return
    }

    const cryptoApi = globalThis.crypto
    const suffix =
      cryptoApi?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const intentGuid = `${choice}-${suffix}`
    const world = { wx: m.wx, wy: 0, wz: m.wz }
    const value = this._createIntentRecord(choice, intentGuid, descriptors, world)
    if (!value) return

    projectGraph.putIntentRecord(value)
    projectGraph.appendControllerIntentRef(intentGuid)
    projectGraph.toggleSceneIntent(activeScene, intentGuid)

    sendGraphCommand({
      op: 'upsert',
      entityType: 'intent',
      guid: intentGuid,
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
    const sceneGuid = projectGraph.getSceneGuid(activeScene)
    if (sceneGuid) sendSceneActivate(sceneGuid)

    getStageOverlay()?.markRenderActivity()
    getParamsHost().openForIntentGuid(intentGuid)
  }

  /**
   * @param {string} intentClass
   * @param {string} guid
   * @param {unknown[]} descriptors
   * @param {{ wx: number, wy: number, wz: number }} world
   * @returns {Record<string, unknown> | null}
   */
  _createIntentRecord (intentClass, guid, descriptors, world) {
    /** @type {Record<string, unknown>} */
    let value = {
      guid,
      class: intentClass,
      position: [world.wx, world.wy, world.wz],
      params: {}
    }

    for (const descriptor of descriptors) {
      const d = /** @type {Record<string, unknown>} */ (descriptor)
      const dotKey = typeof d.dotKey === 'string' ? d.dotKey : ''
      if (!dotKey || !d.isMandatory || d.defaultValue === undefined) continue
      value = cloneAndSetAtDotPath(value, dotKey, cloneDefaultValue(d.defaultValue))
    }

    if (value.name === undefined) {
      value = cloneAndSetAtDotPath(
        value,
        'name',
        intentClass.charAt(0).toUpperCase() + intentClass.slice(1)
      )
    }
    if (intentClass === 'master' && value.radius === undefined) {
      value = cloneAndSetAtDotPath(value, 'radius', 0)
    }
    return value
  }

  _refreshFixtureLockButton () {
    if (!this._fixtureLockBtn) return
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
    const overlay = getStageOverlay()
    if (!overlay) return

    let manager = this._managers.get(modeId) ?? null
    if (!manager) {
      manager = mode.buildManager()
      this._managers.set(modeId, manager)
    }

    this._activeMode = modeId
    overlay.setPolicy(noopPolicy)
    overlay.setSelectionManager(manager)
    overlay.markRenderActivity()

    const btn = this._modeBar?.querySelector(`[data-mode-id="${modeId}"]`)
    btn?.classList.add('btn--active')
    if (modeId === 'performEnable' && btn) btn.textContent = 'Done'
  }

  _exitCurrentMode () {
    if (!this._activeMode) return
    const overlay = getStageOverlay()
    const prev = this._activeMode
    this._activeMode = null
    overlay?.setPolicy(editPolicy)
    overlay?.setSelectionManager(null)
    selectionState.clearAll()
    getParamsHost().close()

    const btn = this._modeBar?.querySelector(`[data-mode-id="${prev}"]`)
    btn?.classList.remove('btn--active')
    const mode = this._modes().find(m => m.id === prev)
    if (btn && mode) btn.textContent = mode.label
    overlay?.markRenderActivity()
  }

  _exitSelectModeIfActive () {
    if (this._activeMode === 'select') {
      this._exitCurrentMode()
    }
  }

  async _onPerformSortClick () {
    const raw = collectPerformButtonInputs()
    if (raw.length === 0) {
      void modalWarn('No perform buttons to sort.')
      return
    }
    const controllerGuid = projectGraph.getControllerGuid()
    if (!controllerGuid) return
    const sortKey = DEFAULT_PERFORM_INPUT_SORT_KEY
    const sorter = new ArraySorter(raw, sortKey)

    const patchOrderToHub = ordered => {
      for (const item of ordered) {
        const guid = String(item.guid ?? '')
        if (!guid) continue
        const idx = item[sortKey]
        if (typeof idx !== 'number' || Number.isNaN(idx)) continue
        sendGraphCommand({
          op: 'patch',
          entityType: 'input',
          guid,
          parent: { entityType: 'controller', guid: controllerGuid },
          patch: { [sortKey]: idx },
          persistence: 'runtimeAndDurable'
        })
      }
      projectGraph.notifyListeners()
    }

    await openModalCard(dismiss => {
      const card = document.createElement('div')
      card.className = 'modal perform-sort-modal'
      card.addEventListener('click', e => e.stopPropagation())

      const title = document.createElement('p')
      title.className = 'modal-text'
      title.textContent =
        'Drag the grip on each row to set Perform button order'

      const listHost = document.createElement('div')
      listHost.className = 'perform-sort-list'

      const actions = document.createElement('div')
      actions.className = 'modal-actions'
      const done = document.createElement('button')
      done.type = 'button'
      done.className = 'btn btn--primary'
      done.textContent = 'Done'
      done.addEventListener('click', () => dismiss('ok'))
      actions.appendChild(done)

      card.appendChild(title)
      card.appendChild(listHost)
      card.appendChild(actions)

      sorter.displaySortDialog(
        listHost,
        item => {
          const wrap = document.createElement('div')
          wrap.className = 'array-sort-row__label'
          wrap.textContent = String(item.name ?? item.guid ?? '')
          return wrap
        },
        () => {},
        ordered => patchOrderToHub(ordered)
      )

      return card
    }).finally(() => {
      patchOrderToHub(sorter.getLiveOrder())
    })
  }

  /** @returns {Iterable<[string, unknown]>} */
  _sceneIntentEntries () {
    const active = projectGraph.getActiveSceneName()
    const guids = active ? new Set(projectGraph.getSceneIntents(active)) : null
    return [...projectGraph.getIntents().entries()]
      .filter(([g]) => !guids || guids.has(g))
      .map(([g, intent]) => [g, projectGraph.getEffectiveIntent(g) ?? intent])
  }

  _buildPerformEnableManager () {
    const self = this
    return new SelectionManager({
      getObjects: () => self._sceneIntentEntries(),
      getWorldPos (obj) {
        const i = /** @type {Record<string, unknown>} */ (obj)
        const pos = /** @type {number[] | undefined} */ (i.position)
        if (!pos || pos.length < 3) return null
        return { wx: pos[0], wz: pos[2] }
      },
      onTap: (id, obj) => {
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
        getStageOverlay()?.markRenderActivity()
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
        const guids = selectionState.getGuids()
        if (guids.size === 0) {
          getParamsHost().close()
        } else {
          getParamsHost().openForSelection(guids)
        }
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
}
