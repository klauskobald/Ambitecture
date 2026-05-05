import { projectGraph } from '../../core/projectGraph.js'
import {
  queueIntentUpdate,
  sendGraphCommand,
  sendSaveProject,
  sendSceneActivate
} from '../../core/outboundQueue.js'
import { warn as modalWarn } from '../../core/Modal.js'
import {
  resolveMultiSelectState,
  resolveEnableState
} from './controlHelpers.js'

/** @param {unknown} value @returns {unknown} */
function cloneDefaultValue (value) {
  if (value === null || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value))
}

export class PropertyControl {
  /**
   * @param {Record<string, unknown>} descriptor
   * @param {(dotKey: string, guids: Set<string>, value: unknown) => void} onCommit
   * @param {number} selectionSize
   */
  constructor (descriptor, onCommit, selectionSize) {
    this._descriptor = descriptor
    this._onCommit = onCommit
    this._selectionSize = selectionSize
    this._isMandatory = !!descriptor.isMandatory
    this._allowOverlay = !!descriptor.allowOverlay
    /** @type {HTMLElement | null} */
    this._controlArea = null
    /** @type {HTMLButtonElement | null} */
    this._toggleBtn = null
    /** @type {HTMLButtonElement | null} */
    this._overlayBtn = null
    /** @type {HTMLButtonElement | null} */
    this._quickPanelBtn = null
    /** @type {Set<string>} */
    this._currentGuids = new Set()
    this._sceneDirty = false
  }

  buildRow () {
    const row = document.createElement('div')
    row.className = 'prop-row'

    const header = document.createElement('div')
    header.className = 'prop-row__header'

    const label = document.createElement('span')
    label.className = 'prop-row__label'
    label.textContent = /** @type {string} */ (
      this._descriptor.name ?? this._descriptor.dotKey
    )

    header.appendChild(label)

    const showQuickPanel =
      this._descriptor.type === 'scalar' && !!this._descriptor.quickPanel
    if (!this._isMandatory) {
      this._toggleBtn = document.createElement('button')
      this._toggleBtn.className = 'prop-row__toggle intent-toggle'
      this._toggleBtn.textContent = 'OFF'
      this._toggleBtn.setAttribute('aria-checked', 'false')
      this._toggleBtn.addEventListener('click', () => this._onToggleClick())
      header.appendChild(this._toggleBtn)
    }

    if (showQuickPanel) {
      this._quickPanelBtn = document.createElement('button')
      this._quickPanelBtn.className =
        'prop-row__toggle intent-toggle intent-quick-panel'
      this._quickPanelBtn.type = 'button'
      this._quickPanelBtn.textContent = '\u2742'
      this._quickPanelBtn.setAttribute('aria-label', 'Quick panel')
      this._quickPanelBtn.setAttribute('aria-checked', 'false')
      this._quickPanelBtn.title = 'Quick panel — show knobs in Perform'
      this._quickPanelBtn.addEventListener('click', () =>
        this._onQuickPanelClick()
      )
      header.appendChild(this._quickPanelBtn)
    }

    if (this._allowOverlay) {
      this._overlayBtn = document.createElement('button')
      this._overlayBtn.className = 'prop-row__toggle intent-toggle'
      this._overlayBtn.textContent = 'Shared'
      this._overlayBtn.setAttribute('aria-checked', 'false')
      this._overlayBtn.addEventListener('click', () => this._onOverlayClick())
      header.appendChild(this._overlayBtn)
    }

    row.appendChild(header)

    this._controlArea = document.createElement('div')
    this._controlArea.className = 'prop-row__control'
    this._controlArea.hidden = !this._isMandatory
    this._buildControlWidget(this._controlArea)
    row.appendChild(this._controlArea)

    return row
  }

  /** @param {Set<string>} guids */
  refresh (guids) {
    this._currentGuids = guids
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)

    if (this._isMandatory) {
      if (this._controlArea) this._controlArea.hidden = false
      this._applyOverlayState(this._resolveOverlayState(guids, dotKey))
      const multiState = resolveMultiSelectState(guids, dotKey)
      this._applyState({
        ...multiState,
        enableState: 'on',
        selectionSize: guids.size
      })
      this._refreshQuickPanel(guids)
      return
    }

    const enableState = resolveEnableState(guids, dotKey)
    const multiState = resolveMultiSelectState(guids, dotKey)

    this._applyEnableState(enableState)
    this._applyOverlayState(this._resolveOverlayState(guids, dotKey))
    if (enableState !== 'off') {
      this._applyState({
        ...multiState,
        enableState,
        selectionSize: guids.size
      })
    }
    this._refreshQuickPanel(guids)
  }

  destroy () {}

  // ── Protected ─────────────────────────────────────────────────────────────

  /** @param {HTMLElement} _controlArea */
  _buildControlWidget (_controlArea) {
    throw new Error(
      `${this.constructor.name} must implement _buildControlWidget()`
    )
  }

  /**
   * @param {{ mode: 'same'|'mixed'|'absent', value: unknown, enableState: 'on'|'off'|'mixed', selectionSize: number }} _state
   */
  _applyState (_state) {
    throw new Error(`${this.constructor.name} must implement _applyState()`)
  }

  _saveProject () {
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    const activeScene = projectGraph.getActiveSceneName()
    const hasOverlayTargets =
      activeScene &&
      [...this._currentGuids].some(guid =>
        projectGraph.isSceneIntentOverlayed(activeScene, guid, dotKey)
      )
    const hasSharedTargets = [...this._currentGuids].some(
      guid =>
        !activeScene ||
        !projectGraph.isSceneIntentOverlayed(activeScene, guid, dotKey)
    )
    if (hasSharedTargets) {
      sendSaveProject('intents', [...projectGraph.getIntents().values()])
    }
    if ((this._sceneDirty || hasOverlayTargets) && activeScene) {
      sendSaveProject('scenes', projectGraph.getScenesData())
      sendSceneActivate(activeScene)
    }
    this._sceneDirty = false
  }

  /**
   * @param {string} guid
   * @param {string} dotKey
   * @param {unknown} value
   */
  _updateProperty (guid, dotKey, value) {
    const activeScene = projectGraph.getActiveSceneName()
    if (
      this._allowOverlay &&
      activeScene &&
      projectGraph.isSceneIntentOverlayed(activeScene, guid, dotKey)
    ) {
      projectGraph.setSceneIntentOverlay(activeScene, guid, dotKey, value)
      this._sceneDirty = true
      return
    }
    const updated = projectGraph.updateIntentProperty(guid, dotKey, value)
    if (updated) queueIntentUpdate(updated)
  }

  /**
   * @param {string} guid
   * @param {string} dotKey
   */
  _removeProperty (guid, dotKey) {
    const activeScene = projectGraph.getActiveSceneName()
    if (
      this._allowOverlay &&
      activeScene &&
      projectGraph.isSceneIntentOverlayed(activeScene, guid, dotKey)
    ) {
      projectGraph.removeSceneIntentOverlay(activeScene, guid, dotKey)
      this._sceneDirty = true
      return
    }
    const updated = projectGraph.removeIntentProperty(guid, dotKey)
    if (updated) queueIntentUpdate(updated)
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /** @param {'on' | 'off' | 'mixed'} enableState */
  _applyEnableState (enableState) {
    if (!this._toggleBtn || !this._controlArea) return
    switch (enableState) {
      case 'on':
        this._toggleBtn.textContent = 'ON'
        this._toggleBtn.setAttribute('aria-checked', 'true')
        this._toggleBtn.classList.add('intent-toggle--enabled')
        this._toggleBtn.classList.remove('prop-row__toggle--mixed')
        this._controlArea.hidden = false
        break
      case 'off':
        this._toggleBtn.textContent = 'OFF'
        this._toggleBtn.setAttribute('aria-checked', 'false')
        this._toggleBtn.classList.remove(
          'intent-toggle--enabled',
          'prop-row__toggle--mixed'
        )
        this._controlArea.hidden = true
        break
      case 'mixed':
        this._toggleBtn.textContent = 'MIX'
        this._toggleBtn.setAttribute('aria-checked', 'mixed')
        this._toggleBtn.classList.add('prop-row__toggle--mixed')
        this._toggleBtn.classList.remove('intent-toggle--enabled')
        this._controlArea.hidden = false
        break
    }
  }

  /** @param {'overlay' | 'shared' | 'mixed'} overlayState */
  _applyOverlayState (overlayState) {
    if (!this._overlayBtn) return
    switch (overlayState) {
      case 'overlay':
        this._overlayBtn.textContent = 'Overlay'
        this._overlayBtn.setAttribute('aria-checked', 'true')
        this._overlayBtn.setAttribute('aria-disabled', 'false')
        this._overlayBtn.classList.add('intent-toggle--enabled')
        this._overlayBtn.classList.remove('prop-row__toggle--mixed')
        break
      case 'shared':
        this._overlayBtn.textContent = 'Shared'
        this._overlayBtn.setAttribute('aria-checked', 'false')
        this._overlayBtn.setAttribute('aria-disabled', 'false')
        this._overlayBtn.classList.remove(
          'intent-toggle--enabled',
          'prop-row__toggle--mixed'
        )
        break
      case 'mixed':
        this._overlayBtn.textContent = 'Mixed'
        this._overlayBtn.setAttribute('aria-checked', 'mixed')
        this._overlayBtn.setAttribute('aria-disabled', 'true')
        this._overlayBtn.classList.add('prop-row__toggle--mixed')
        this._overlayBtn.classList.remove('intent-toggle--enabled')
        break
    }
  }

  /**
   * @param {Set<string>} guids
   * @param {string} dotKey
   * @returns {'overlay' | 'shared' | 'mixed'}
   */
  _resolveOverlayState (guids, dotKey) {
    const activeScene = projectGraph.getActiveSceneName()
    let overlayCount = 0
    let total = 0
    for (const guid of guids) {
      if (!projectGraph.getIntents().has(guid)) continue
      total++
      if (
        activeScene &&
        projectGraph.isSceneIntentOverlayed(activeScene, guid, dotKey)
      )
        overlayCount++
    }
    if (total === 0 || overlayCount === 0) return 'shared'
    if (overlayCount === total) return 'overlay'
    return 'mixed'
  }

  _onToggleClick () {
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    const enableState = resolveEnableState(this._currentGuids, dotKey)
    const defaultValue = this._descriptor.defaultValue

    if (enableState === 'on') {
      for (const guid of this._currentGuids) {
        this._removeProperty(guid, dotKey)
      }
      if (this._quickPanelBtn) {
        const controllerGuid = projectGraph.getControllerGuid()
        if (controllerGuid) {
          for (const guid of this._currentGuids) {
            if (!projectGraph.getIntents().has(guid)) continue
            let keys = projectGraph.getQuickPanelDotKeys(guid)
            if (!keys.includes(dotKey)) continue
            keys = keys.filter(k => k !== dotKey)
            const cmd = projectGraph.patchControllerState(
              `interactionPolicies.quickPanel.${guid}`,
              keys
            )
            if (cmd) {
              sendGraphCommand({
                op: 'patch',
                entityType: 'controller',
                guid: controllerGuid,
                patch: cmd.patch,
                persistence: 'runtimeAndDurable'
              })
            }
          }
        }
      }
    } else {
      for (const guid of this._currentGuids) {
        this._updateProperty(guid, dotKey, cloneDefaultValue(defaultValue))
      }
    }

    this._saveProject()
    this.refresh(this._currentGuids)
  }

  _onOverlayClick () {
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    const activeScene = projectGraph.getActiveSceneName()
    if (!activeScene) return

    const overlayState = this._resolveOverlayState(this._currentGuids, dotKey)
    if (overlayState === 'mixed') {
      modalWarn(
        'Selected intents have mixed overlay state. Select only Overlay or only Shared intents before toggling this property.'
      )
      return
    }

    if (overlayState === 'shared') {
      for (const guid of this._currentGuids) {
        const value = projectGraph.getEffectiveIntentProperty(guid, dotKey)
        if (value !== undefined) {
          projectGraph.setSceneIntentOverlay(activeScene, guid, dotKey, value)
        }
      }
    } else {
      for (const guid of this._currentGuids) {
        projectGraph.removeSceneIntentOverlay(activeScene, guid, dotKey)
      }
    }

    sendSaveProject('scenes', projectGraph.getScenesData())
    sendSceneActivate(activeScene)
    this.refresh(this._currentGuids)
  }

  /**
   * @param {Set<string>} guids
   */
  _refreshQuickPanel (guids) {
    if (!this._quickPanelBtn) return
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    const qpState = this._resolveQuickPanelState(guids, dotKey)
    this._applyQuickPanelVisual(qpState)
    const enableState = this._isMandatory
      ? 'on'
      : resolveEnableState(guids, dotKey)
    const blockQuickPanel = enableState === 'off'
    this._quickPanelBtn.disabled = blockQuickPanel
    this._quickPanelBtn.setAttribute(
      'aria-disabled',
      blockQuickPanel ? 'true' : 'false'
    )
    if (blockQuickPanel) {
      this._quickPanelBtn.title = 'Turn property ON to use quick panel'
    } else {
      this._quickPanelBtn.title = 'Quick panel — show knobs in Perform'
    }
  }

  /**
   * @param {Set<string>} guids
   * @param {string} dotKey
   * @returns {'on'|'off'|'mixed'}
   */
  _resolveQuickPanelState (guids, dotKey) {
    let onCount = 0
    let total = 0
    for (const guid of guids) {
      if (!projectGraph.getIntents().has(guid)) continue
      total++
      if (projectGraph.getQuickPanelDotKeys(guid).includes(dotKey)) onCount++
    }
    if (total === 0 || onCount === 0) return 'off'
    if (onCount === total) return 'on'
    return 'mixed'
  }

  /** @param {'on'|'off'|'mixed'} qpState */
  _applyQuickPanelVisual (qpState) {
    if (!this._quickPanelBtn) return
    switch (qpState) {
      case 'on':
        this._quickPanelBtn.setAttribute('aria-checked', 'true')
        this._quickPanelBtn.classList.add('intent-toggle--enabled')
        this._quickPanelBtn.classList.remove('prop-row__toggle--mixed')
        break
      case 'mixed':
        this._quickPanelBtn.setAttribute('aria-checked', 'mixed')
        this._quickPanelBtn.classList.add('prop-row__toggle--mixed')
        this._quickPanelBtn.classList.remove('intent-toggle--enabled')
        break
      case 'off':
      default:
        this._quickPanelBtn.setAttribute('aria-checked', 'false')
        this._quickPanelBtn.classList.remove(
          'intent-toggle--enabled',
          'prop-row__toggle--mixed'
        )
        break
    }
  }

  _onQuickPanelClick () {
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    if (resolveEnableState(this._currentGuids, dotKey) === 'off') return
    const controllerGuid = projectGraph.getControllerGuid()
    if (!controllerGuid) return
    const prev = this._resolveQuickPanelState(this._currentGuids, dotKey)
    const makeOn = prev !== 'on'

    for (const guid of this._currentGuids) {
      if (!projectGraph.getIntents().has(guid)) continue
      let keys = projectGraph.getQuickPanelDotKeys(guid)
      if (makeOn) {
        if (!keys.includes(dotKey)) keys = [...keys, dotKey]
      } else {
        keys = keys.filter(k => k !== dotKey)
      }
      const cmd = projectGraph.patchControllerState(
        `interactionPolicies.quickPanel.${guid}`,
        keys
      )
      if (cmd) {
        sendGraphCommand({
          op: 'patch',
          entityType: 'controller',
          guid: controllerGuid,
          patch: cmd.patch,
          persistence: 'runtimeAndDurable'
        })
      }
    }
    this.refresh(this._currentGuids)
  }
}
