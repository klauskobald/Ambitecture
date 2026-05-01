import { editPolicy, noopPolicy } from '../viewport/interactionPolicies.js'
import { intentGuid } from '../core/stores.js'
import { projectGraph } from '../core/projectGraph.js'
import { queueIntentUpdate } from '../core/outboundQueue.js'
import { SelectionManager } from '../viewport/selectionManager.js'
import { ColorPicker } from '../ui/colorPicker.js'
import { hslPalette } from '../ui/palettes/hslPalette.js'
import { toCSSRGB } from '../core/color.js'
import { selectionState } from '../edit/selectionState.js'
import { ActionBar } from '../edit/ActionBar.js'
import { PropertiesDrawer } from '../edit/PropertiesDrawer.js'
import { resolveDescriptorsForClass } from '../core/systemCapabilities.js'

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
      onCopy: () => {},
      onDelete: () => {}
    })
    this._el.appendChild(this._actionBar.buildElement())

    this._drawer = new PropertiesDrawer()
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.appendChild(this._el)
    this._drawer.mount()
  }

  activate () {
    this._overlay.setPolicy(editPolicy)
    this._overlay.resize()
    this._el.hidden = false

    this._selectionUnsub = selectionState.subscribe(() => {
      this._actionBar.refresh(selectionState.getSize())
    })
    this._actionBar.refresh(selectionState.getSize())

    this._overlay.setDoubleTapIntentCallback(guid => this._handleDoubleTapIntent(guid))
  }

  deactivate () {
    this._exitCurrentMode()
    this._colorPicker.close()
    this._el.hidden = true
    this._overlay.setDoubleTapIntentCallback(null)

    if (this._selectionUnsub) {
      this._selectionUnsub()
      this._selectionUnsub = null
    }
  }

  // ── Mode registry ─────────────────────────────────────────────────────────────

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
  }

  // ── Manager builders ──────────────────────────────────────────────────────────

  /** @returns {Iterable<[string, unknown]>} only intents in the active scene */
  _sceneIntentEntries () {
    const active = projectGraph.getActiveSceneName()
    const guids = active ? new Set(projectGraph.getSceneIntents(active)) : null
    return [...projectGraph.getIntents().entries()].filter(([g]) => !guids || guids.has(g))
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
        projectGraph.setIntentConfig(guid, 'performEnabled', !projectGraph.getIntentConfig(guid).performEnabled)
      },
      drawBubble (ctx, px, py, id, obj) {
        const guid = intentGuid(obj)
        const enabled = !!(projectGraph.getIntentConfig(guid).performEnabled)
        const R = 24
        ctx.save()
        ctx.beginPath()
        ctx.arc(px, py, R, 0, Math.PI * 2)
        ctx.fillStyle = enabled ? 'rgba(85, 170, 255, 0.88)' : 'rgba(30, 30, 30, 0.82)'
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

  _onModifyClick () {
    const descriptors = resolveDescriptorsForClass('light')
    if (!descriptors) return
    this._drawer.open(descriptors, selectionState.getGuids())
  }

  /** @param {string} guid */
  _handleDoubleTapIntent (guid) {
    selectionState.clearAll()
    selectionState.toggleGuid(guid)
    this._onModifyClick()
  }
}
