import { PropertyPanel } from '../edit/PropertyPanel.js'
import { ConnectionsEditor } from '../edit/ConnectionsEditor.js'
import { selectionState } from '../edit/selectionState.js'
import { projectGraph } from '../core/projectGraph.js'
import { intentName } from '../core/stores.js'
import { resolveDescriptorsForClass } from '../core/systemCapabilities.js'
import { findLayoutTagHost } from './layoutTagHost.js'
import {
  runCopySelectedIntents,
  runDeleteSelectedIntents
} from '../edit/intentBulkActions.js'
import { exitStageEditSelectModeIfActive } from './stageOverlayCoordinator.js'
import { getStageOverlay } from './stageOverlayHost.js'

export class IntentParamsHost {
  constructor () {
    /** @type {HTMLElement | null} */
    this._overlayEl = null
    /** @type {HTMLElement | null} */
    this._body = null
    /** @type {HTMLElement | null} */
    this._title = null
    /** @type {PropertyPanel | null} */
    this._panel = null
    /** @type {ConnectionsEditor | null} */
    this._connections = null
    /** @type {HTMLElement | null} */
    this._footer = null
    /** @type {HTMLButtonElement | null} */
    this._copyBtn = null
    /** @type {HTMLButtonElement | null} */
    this._deleteBtn = null
    /** @type {Set<string>} */
    this._currentGuids = new Set()
    /** @type {unknown[]} */
    this._lastDescriptors = []
    /** @type {(() => void) | null} */
    this._selectionUnsub = null
    /** @type {(() => void) | null} */
    this._graphUnsub = null
  }

  /** @returns {boolean} */
  isOpen () {
    return this._overlayEl != null && !this._overlayEl.hidden
  }

  _ensureOverlay () {
    const host = findLayoutTagHost()
    if (!host) return false

    if (this._overlayEl && this._overlayEl.parentElement === host) {
      return true
    }

    this._overlayEl = document.createElement('div')
    this._overlayEl.className = 'stage-edit-params-overlay'
    this._overlayEl.hidden = true
    this._overlayEl.setAttribute('aria-hidden', 'true')

    const header = document.createElement('div')
    header.className = 'stage-edit-params-overlay__header'

    this._title = document.createElement('span')
    this._title.className = 'stage-edit-params-overlay__title'

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'stage-edit-params-overlay__close'
    closeBtn.setAttribute('aria-label', 'Close')
    closeBtn.textContent = '×'
    closeBtn.addEventListener('click', () => this.close())

    header.appendChild(this._title)
    header.appendChild(closeBtn)

    this._body = document.createElement('div')
    this._body.className = 'stage-edit-params-overlay__body'

    this._footer = document.createElement('div')
    this._footer.className = 'stage-edit-params-overlay__footer'

    this._copyBtn = document.createElement('button')
    this._copyBtn.type = 'button'
    this._copyBtn.className = 'btn stage-edit-params-overlay__action'
    this._copyBtn.textContent = 'Copy'
    this._copyBtn.addEventListener('click', () => void this._onFooterCopy())

    this._deleteBtn = document.createElement('button')
    this._deleteBtn.type = 'button'
    this._deleteBtn.className =
      'btn stage-edit-params-overlay__action stage-edit-params-overlay__action--danger'
    this._deleteBtn.textContent = 'Delete'
    this._deleteBtn.addEventListener('click', () => void this._onFooterDelete())

    this._footer.appendChild(this._copyBtn)
    this._footer.appendChild(this._deleteBtn)

    this._overlayEl.appendChild(header)
    this._overlayEl.appendChild(this._body)
    this._overlayEl.appendChild(this._footer)
    host.appendChild(this._overlayEl)
    return true
  }

  /**
   * @param {unknown[]} descriptors
   * @param {Set<string>} guids
   */
  open (descriptors, guids) {
    if (
      !this._ensureOverlay() ||
      !this._body ||
      !this._title ||
      !this._overlayEl
    )
      return

    this._lastDescriptors = descriptors
    this._overlayEl.hidden = false
    this._overlayEl.setAttribute('aria-hidden', 'false')
    this._rebuildPanel(guids)

    if (!this._selectionUnsub) {
      this._selectionUnsub = selectionState.subscribe(() =>
        this._onSelectionChange()
      )
    }
    if (!this._graphUnsub) {
      this._graphUnsub = projectGraph.subscribe(
        ['intents:def', 'intents:runtime', 'scenes', 'controller'],
        () => this._onProjectGraphChange()
      )
    }
  }

  close () {
    if (!this._overlayEl) return
    this._overlayEl.hidden = true
    this._overlayEl.setAttribute('aria-hidden', 'true')
    if (this._panel) {
      this._panel.destroy()
      this._panel = null
    }
    if (this._connections) {
      this._connections.destroy()
      this._connections = null
    }
    if (this._body) this._body.replaceChildren()
    if (this._selectionUnsub) {
      this._selectionUnsub()
      this._selectionUnsub = null
    }
    if (this._graphUnsub) {
      this._graphUnsub()
      this._graphUnsub = null
    }
    this._currentGuids = new Set()
    getStageOverlay()?.setEditHighlight(null)
    selectionState.clearAll()
  }

  /** @param {string} guid */
  openForIntentGuid (guid) {
    const intent = projectGraph.getEffectiveIntent(guid)
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return
    const cls = String(
      /** @type {Record<string, unknown>} */ (intent).class ?? ''
    )
    if (!cls) return
    const descriptors = resolveDescriptorsForClass(cls)
    if (!descriptors) return
    selectionState.clearAll()
    selectionState.toggleGuid(guid)
    const guids = new Set([guid])
    this.open(descriptors, guids)
  }

  /** @param {Set<string>} guids */
  openForSelection (guids) {
    if (guids.size === 0) return
    const intentClass = this._selectedIntentClass(guids)
    if (!intentClass) return
    const descriptors = resolveDescriptorsForClass(intentClass)
    if (!descriptors) return
    this.open(descriptors, guids)
  }

  /** @param {Set<string>} guids */
  _selectedIntentClass (guids) {
    /** @type {string | null} */
    let cls = null
    for (const g of guids) {
      const intent = projectGraph.getEffectiveIntent(g)
      if (!intent || typeof intent !== 'object' || Array.isArray(intent))
        return null
      const c = String(
        /** @type {Record<string, unknown>} */ (intent).class ?? ''
      )
      if (!c) return null
      if (cls === null) cls = c
      else if (cls !== c) return null
    }
    return cls
  }

  /** @param {Set<string>} guids */
  _rebuildPanel (guids) {
    if (!this._body || !this._title) return
    if (this._panel) {
      this._panel.destroy()
    }
    if (this._connections) {
      this._connections.destroy()
      this._connections = null
    }
    this._body.replaceChildren()
    this._currentGuids = guids
    this._refreshTitle()
    this._panel = new PropertyPanel(this._lastDescriptors, guids.size, guids)
    const panelEl = this._panel.buildElement()
    this._body.appendChild(panelEl)
    this._panel.refresh(guids)
    this._maybeBuildConnections(guids, panelEl)
    this._refreshFooterActions()
    this._syncEditHighlight()
  }

  /** Highlight the edited intent on the stage; only for a single-object edit. */
  _syncEditHighlight () {
    const overlay = getStageOverlay()
    if (!overlay) return
    if (this._currentGuids.size === 1) {
      const [g] = [...this._currentGuids]
      overlay.setEditHighlight({ kind: 'intent', id: g })
    } else {
      overlay.setEditHighlight(null)
    }
  }

  /**
   * Connections editor only makes sense for a single non-master intent. Placed inside the panel
   * as the last card.
   * @param {Set<string>} guids
   * @param {HTMLElement} panelEl
   */
  _maybeBuildConnections (guids, panelEl) {
    if (guids.size !== 1) return
    const [guid] = [...guids]
    const intent = projectGraph.getEffectiveIntent(guid)
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return
    if (/** @type {Record<string, unknown>} */ (intent).class === 'master') return
    this._connections = new ConnectionsEditor(guid)
    const card = document.createElement('div')
    card.className = 'prop-row prop-row--connections'
    card.appendChild(this._connections.buildElement())
    panelEl.appendChild(card)
  }

  _refreshFooterActions () {
    const n = this._currentGuids.size
    const enabled = n > 0
    if (this._copyBtn) this._copyBtn.disabled = !enabled
    if (this._deleteBtn) this._deleteBtn.disabled = !enabled
  }

  async _onFooterCopy () {
    const ok = await runCopySelectedIntents()
    if (!ok) return
    exitStageEditSelectModeIfActive()
    if (this.isOpen()) this.close()
    getStageOverlay()?.markRenderActivity()
  }

  async _onFooterDelete () {
    const ok = await runDeleteSelectedIntents()
    if (!ok) return
    exitStageEditSelectModeIfActive()
    if (this.isOpen()) this.close()
    getStageOverlay()?.markRenderActivity()
  }

  _refreshTitle () {
    if (!this._title) return
    const guids = this._currentGuids
    const size = guids.size
    if (size === 0) return
    if (size === 1) {
      const [g] = [...guids]
      const intent = projectGraph.getEffectiveIntent(g)
      const n = intentName(intent)
      this._title.textContent = n ? `Intent: ${n}` : `Intent: ${g}`
      return
    }
    this._title.textContent = `Modifying ${size} intents`
  }

  _onProjectGraphChange () {
    if (!this.isOpen() || !this._panel) return
    const guids = selectionState.getGuids()
    if (guids.size === 0) {
      this.close()
      return
    }
    this._currentGuids = guids
    this._panel.refresh(guids)
    this._refreshTitle()
    this._refreshFooterActions()
  }

  _onSelectionChange () {
    const guids = selectionState.getGuids()
    if (guids.size === 0) {
      this.close()
      return
    }
    this._rebuildPanel(guids)
  }

  /** Call when layout preset changes so overlay re-binds to new tagged host. */
  rebindHost () {
    const wasOpen = this.isOpen()
    const guids = new Set(this._currentGuids)
    const desc = this._lastDescriptors
    if (this._overlayEl) {
      this._overlayEl.remove()
      this._overlayEl = null
      this._body = null
      this._title = null
      this._footer = null
      this._copyBtn = null
      this._deleteBtn = null
    }
    if (wasOpen && guids.size > 0) {
      this.open(desc, guids)
    }
  }
}
