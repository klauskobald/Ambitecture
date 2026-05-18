import {
  editPolicy,
  noopPolicy,
  getEditFixturesUnlocked,
  setEditFixturesUnlocked
} from '../../viewport/interactionPolicies.js'
import { attachStageTo, detachStage } from '../../stage/stageCommon.js'
import { getStageOverlay } from '../../stage/stageOverlayHost.js'
import {
  setEditMode,
  setPerformMode,
  setEditDoubleTapHandlers,
  clearEditDoubleTapHandlers
} from '../../stage/stageOverlayCoordinator.js'
import { IntentParamsHost } from '../../stage/IntentParamsHost.js'
import { selectionState } from '../../edit/selectionState.js'
import { projectGraph } from '../../core/projectGraph.js'
import { intentGuid } from '../../core/stores.js'
import { toCSSRGB } from '../../core/color.js'
import { SelectionManager } from '../../viewport/selectionManager.js'
import { warn as modalWarn, openModalCard } from '../../core/Modal.js'
import { sendGraphCommand, sendSaveProject } from '../../core/outboundQueue.js'
import {
  ArraySorter,
  DEFAULT_PERFORM_INPUT_SORT_KEY
} from '../../core/arraySorter.js'
import { collectPerformButtonInputs } from '../../core/performButtonInputs.js'

/** @type {IntentParamsHost | null} */
let sharedParamsHost = null

function getParamsHost () {
  if (!sharedParamsHost) sharedParamsHost = new IntentParamsHost()
  return sharedParamsHost
}

export function rebindIntentParamsHost () {
  getParamsHost().rebindHost()
}

export class StageEditPane {
  /** @param {string | undefined} [_arg] */
  static getButtonLabel (_arg) {
    return 'Edit'
  }

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
      btn.addEventListener('click', () => this._toggleMode(mode.id))
      bar.appendChild(btn)
      this._managers.set(mode.id, null)
    }

    this._performSortBtn = document.createElement('button')
    this._performSortBtn.type = 'button'
    this._performSortBtn.className = 'btn btn-mode-toggle'
    this._performSortBtn.textContent = 'Perform sort'
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

    modeBar.appendChild(bar)
  }

  activate () {
    if (this._stageSlot) attachStageTo(this._stageSlot)

    setEditFixturesUnlocked(false)
    this._refreshFixtureLockButton()
    setEditMode()
    setEditDoubleTapHandlers(
      guid => getParamsHost().openForIntentGuid(guid),
      () => {}
    )

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
    getParamsHost().close()
    setPerformMode()
    if (this._selectionUnsub) {
      this._selectionUnsub()
      this._selectionUnsub = null
    }
    detachStage()
  }

  _toggleFixtureLock () {
    setEditFixturesUnlocked(!getEditFixturesUnlocked())
    this._refreshFixtureLockButton()
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
        if (guids.size === 1) {
          getParamsHost().openForSelection(guids)
        } else if (guids.size === 0) {
          getParamsHost().close()
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
