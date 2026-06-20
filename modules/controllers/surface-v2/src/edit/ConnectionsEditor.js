import { projectGraph } from '../core/projectGraph.js'
import { sendGraphCommand } from '../core/outboundQueue.js'
import { getConnectorTypes } from '../core/systemCapabilities.js'
import { intentName, intentGuid } from '../core/stores.js'
import { SelectionManager } from '../viewport/selectionManager.js'
import { ScalarDragSlider } from './components/ScalarDragSlider.js'
import { getStageOverlay } from '../stage/stageOverlayHost.js'
import { HelpManager } from '../core/help/HelpManager.js'

const cryptoApi = globalThis.crypto

/**
 * Selection manager that also reports an empty (missed) tap, so tapping the dark cancels the connect
 * gesture. The overlay routes every tap to the active manager and ignores the return value.
 */
class ConnectPickManager extends SelectionManager {
  /** @param {object} opts @param {() => void} opts.onMiss */
  constructor (opts) {
    super(opts)
    this._onMiss = opts.onMiss
  }

  handleTap (cx, cy, spatial, simRect, overlayRect) {
    const hit = super.handleTap(cx, cy, spatial, simRect, overlayRect)
    if (!hit) this._onMiss()
    return hit
  }
}

/**
 * Physical-connection editor for a single intent, embedded in the intent params overlay. Connections
 * are durable `connector` graph entities referencing two intents symmetrically; this lists every link
 * touching the source intent, lets the operator add one by tapping another intent on the stage,
 * retune its kind / strength, or release it. Removing an endpoint intent cascades on the hub, so the
 * list never shows a stale row.
 */
export class ConnectionsEditor {
  /** @param {string} sourceGuid */
  constructor (sourceGuid) {
    this._sourceGuid = sourceGuid
    /** @type {HTMLElement | null} */
    this._root = null
    /** @type {HTMLElement | null} */
    this._list = null
    /** @type {HTMLButtonElement | null} */
    this._connectBtn = null
    /** @type {(() => void) | null} */
    this._unsub = null
    this._picking = false
  }

  /** @returns {HTMLElement} */
  buildElement () {
    this._root = document.createElement('section')
    this._root.className = 'connections-editor'

    const header = document.createElement('div')
    header.className = 'connections-editor__header'
    const title = document.createElement('span')
    title.className = 'connections-editor__title'
    title.textContent = 'Connections'
    this._connectBtn = document.createElement('button')
    this._connectBtn.type = 'button'
    this._connectBtn.className = 'btn connections-editor__connect'
    this._connectBtn.textContent = '+ Connect'
    this._connectBtn.addEventListener('click', () => this._togglePick())
    header.appendChild(title)
    header.appendChild(this._connectBtn)

    this._list = document.createElement('div')
    this._list.className = 'connections-editor__list'

    this._root.appendChild(header)
    this._root.appendChild(this._list)

    this._unsub = projectGraph.subscribe(
      ['connectors', 'intents:def', 'scenes'],
      () => this._renderList()
    )
    this._renderList()
    return this._root
  }

  destroy () {
    if (this._picking) this._finishPick()
    if (this._unsub) {
      this._unsub()
      this._unsub = null
    }
    this._root = null
    this._list = null
    this._connectBtn = null
  }

  _renderList () {
    if (!this._list) return
    this._list.replaceChildren()
    const connectors = projectGraph.getConnectorsForIntent(this._sourceGuid)
    if (connectors.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'connections-editor__empty'
      empty.textContent = 'No connections.'
      this._list.appendChild(empty)
      return
    }
    const activeGuids = this._activeSceneIntentGuids()
    for (const connector of connectors) {
      this._list.appendChild(this._buildRow(connector, activeGuids))
    }
  }

  /** @returns {Set<string> | null} intent guids active in the current scene, or null when no scene is active. */
  _activeSceneIntentGuids () {
    const active = projectGraph.getActiveSceneName()
    if (!active) return null
    return new Set(projectGraph.getSceneIntents(active))
  }

  /** @param {Record<string, unknown>} connector @param {Set<string> | null} activeGuids */
  _buildRow (connector, activeGuids) {
    const guid = String(connector.guid ?? '')
    const otherGuid =
      connector.aGuid === this._sourceGuid
        ? String(connector.bGuid ?? '')
        : String(connector.aGuid ?? '')
    const isOtherInactive = activeGuids !== null && !activeGuids.has(otherGuid)

    const row = document.createElement('div')
    row.className = 'connections-editor__row'
    if (isOtherInactive) {
      row.classList.add('connections-editor__row--disabled')
      row.title = 'This intent is deactivated in the current scene'
    }

    const name = document.createElement('span')
    name.className = 'connections-editor__name'
    name.textContent = this._intentLabel(otherGuid)

    const kindPills = document.createElement('div')
    kindPills.className = 'prop-pills connections-editor__kind'
    for (const type of getConnectorTypes() ?? []) {
      const pill = document.createElement('button')
      pill.type = 'button'
      pill.className = 'prop-pill intent-toggle'
      pill.textContent = type.name
      pill.dataset.value = type.kind
      const active = type.kind === connector.kind
      pill.classList.toggle('prop-pill--active', active)
      pill.classList.toggle('intent-toggle--enabled', active)
      if (isOtherInactive) pill.disabled = true
      else pill.addEventListener('click', () => this._setKind(guid, type.kind))
      kindPills.appendChild(pill)
    }

    const paramHost = document.createElement('span')
    paramHost.className = 'connections-editor__param'
    this._buildParamControl(
      paramHost,
      guid,
      String(connector.kind ?? ''),
      connector,
      isOtherInactive
    )

    const trash = document.createElement('button')
    trash.type = 'button'
    trash.className = 'btn connections-editor__trash'
    trash.setAttribute('aria-label', 'Release connection')
    trash.textContent = '🗑'
    if (isOtherInactive) trash.disabled = true
    else trash.addEventListener('click', () => this._remove(guid))

    row.appendChild(name)
    row.appendChild(kindPills)
    row.appendChild(paramHost)
    row.appendChild(trash)
    return row
  }

  /**
   * @param {HTMLElement} host
   * @param {string} connGuid
   * @param {string} kind
   * @param {Record<string, unknown>} connector
   * @param {boolean} [disabled]
   */
  _buildParamControl (host, connGuid, kind, connector, disabled = false) {
    host.replaceChildren()
    const type = (getConnectorTypes() ?? []).find(t => t.kind === kind)
    const param = /** @type {Record<string, unknown> | undefined} */ (
      type?.params?.[0]
    )
    if (!param || typeof param.dotKey !== 'string') return
    const dotKey = param.dotKey
    const range = /** @type {number[] | undefined} */ (param.range)
    const min = range?.[0] ?? 0
    const max = range?.[1] ?? 1
    const params = /** @type {Record<string, unknown>} */ (
      connector.params ?? {}
    )
    const initial =
      typeof params[dotKey] === 'number'
        ? /** @type {number} */ (params[dotKey])
        : Number(param.defaultValue ?? 0)

    if (disabled) {
      const readonly = document.createElement('span')
      readonly.className = 'connections-editor__param-readonly'
      readonly.textContent = Number.isFinite(initial) ? initial.toFixed(2) : ''
      host.appendChild(readonly)
      return
    }

    let pending = initial
    const slider = new ScalarDragSlider({
      min,
      max,
      step: Number(param.step ?? 0.01),
      value: initial,
      onInput: v => {
        pending = v
      },
      onCommit: () => this._setParam(connGuid, dotKey, pending)
    })
    slider.mount(host)
  }

  _togglePick () {
    if (this._picking) this._finishPick()
    else this._startPick()
  }

  _startPick () {
    const overlay = getStageOverlay()
    if (!overlay) return
    const connected = new Set(
      projectGraph
        .getConnectorsForIntent(this._sourceGuid)
        .map(c =>
          c.aGuid === this._sourceGuid ? String(c.bGuid) : String(c.aGuid)
        )
    )
    const self = this._sourceGuid
    const candidates = () =>
      this._sceneIntentEntries().filter(([guid, intent]) => {
        if (guid === self || connected.has(guid)) return false
        return (
          /** @type {Record<string, unknown>} */ (intent).class !== 'master'
        )
      })

    const manager = new ConnectPickManager({
      getObjects: candidates,
      getWorldPos (obj) {
        const pos = /** @type {number[] | undefined} */ (
          /** @type {Record<string, unknown>} */ (obj).position
        )
        if (!pos || pos.length < 3) return null
        return { wx: pos[0], wz: pos[2] }
      },
      onTap: (_id, obj) => {
        this._connect(intentGuid(obj))
        this._finishPick()
      },
      onMiss: () => this._finishPick(),
      drawBubble (ctx, px, py) {
        const R = 26
        ctx.save()
        ctx.beginPath()
        ctx.arc(px, py, R, 0, Math.PI * 2)
        ctx.strokeStyle = '#ffd24a'
        ctx.lineWidth = 3
        ctx.setLineDash([6, 4])
        ctx.stroke()
        ctx.restore()
      }
    })

    this._picking = true
    if (this._connectBtn) this._connectBtn.textContent = 'Tap an intent…'
    this._setOverlayHidden(true)
    void HelpManager.show('connectIntent', {
      host: 'edit-panel',
      onClose: () => this._finishPick()
    })
    overlay.setSelectionManager(manager)
    overlay.markRenderActivity()
  }

  _finishPick () {
    this._picking = false
    const overlay = getStageOverlay()
    overlay?.setSelectionManager(null)
    overlay?.markRenderActivity()
    HelpManager.hide()
    this._setOverlayHidden(false)
    if (this._connectBtn) this._connectBtn.textContent = '+ Connect'
  }

  /** Hide/show the params overlay so the stage underneath is tappable during a pick. @param {boolean} hidden */
  _setOverlayHidden (hidden) {
    const overlayEl = this._root?.closest('.stage-edit-params-overlay')
    if (overlayEl instanceof HTMLElement) {
      overlayEl.hidden = hidden
      overlayEl.setAttribute('aria-hidden', String(hidden))
    }
  }

  /** @returns {Array<[string, Record<string, unknown>]>} effective active-scene intents. */
  _sceneIntentEntries () {
    const active = projectGraph.getActiveSceneName()
    const guids = active ? new Set(projectGraph.getSceneIntents(active)) : null
    /** @type {Array<[string, Record<string, unknown>]>} */
    const out = []
    for (const [g, intent] of projectGraph.getIntents().entries()) {
      if (guids && !guids.has(g)) continue
      const eff = projectGraph.getEffectiveIntent(g) ?? intent
      if (eff && typeof eff === 'object' && !Array.isArray(eff)) {
        out.push([g, /** @type {Record<string, unknown>} */ (eff)])
      }
    }
    return out
  }

  /** @param {string} targetGuid */
  _connect (targetGuid) {
    if (!targetGuid || targetGuid === this._sourceGuid) return
    const guid = `connector-${
      cryptoApi?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`
    }`
    const kind = (getConnectorTypes() ?? [])[0]?.kind ?? 'rod'
    const record = {
      guid,
      kind,
      aGuid: this._sourceGuid,
      bGuid: targetGuid,
      restLength: this._distanceTo(targetGuid),
      params: this._defaultParams(kind)
    }
    projectGraph.putConnectorRecord(record)
    sendGraphCommand({
      op: 'upsert',
      entityType: 'connector',
      guid,
      value: record,
      persistence: 'runtimeAndDurable'
    })
  }

  /** @param {string} connGuid @param {string} kind */
  _setKind (connGuid, kind) {
    const current = this._connectorByGuid(connGuid)
    const params = this._defaultParams(kind)
    if (current) projectGraph.putConnectorRecord({ ...current, kind, params })
    sendGraphCommand({
      op: 'patch',
      entityType: 'connector',
      guid: connGuid,
      patch: { kind, params },
      persistence: 'runtimeAndDurable'
    })
  }

  /** @param {string} connGuid @param {string} dotKey @param {number} value */
  _setParam (connGuid, dotKey, value) {
    const current = this._connectorByGuid(connGuid)
    if (current) {
      const params = { ...(current.params ?? {}), [dotKey]: value }
      projectGraph.putConnectorRecord({ ...current, params })
    }
    sendGraphCommand({
      op: 'patch',
      entityType: 'connector',
      guid: connGuid,
      patch: { [`params.${dotKey}`]: value },
      persistence: 'runtimeAndDurable'
    })
  }

  /** @param {string} connGuid */
  _remove (connGuid) {
    projectGraph.removeConnectorLocal(connGuid)
    sendGraphCommand({
      op: 'remove',
      entityType: 'connector',
      guid: connGuid,
      persistence: 'runtimeAndDurable'
    })
  }

  /** @param {string} guid @returns {Record<string, unknown> | null} */
  _connectorByGuid (guid) {
    const c = projectGraph.getConnectors().get(guid)
    return c ?? null
  }

  /** @param {string} kind @returns {Record<string, number>} */
  _defaultParams (kind) {
    const type = (getConnectorTypes() ?? []).find(t => t.kind === kind)
    /** @type {Record<string, number>} */
    const out = {}
    for (const param of type?.params ?? []) {
      const p = /** @type {Record<string, unknown>} */ (param)
      if (typeof p.dotKey === 'string' && typeof p.defaultValue === 'number') {
        out[p.dotKey] = p.defaultValue
      }
    }
    return out
  }

  /** @param {string} targetGuid @returns {number} */
  _distanceTo (targetGuid) {
    const a = this._position(this._sourceGuid)
    const b = this._position(targetGuid)
    const dx = a[0] - b[0]
    const dy = a[1] - b[1]
    const dz = a[2] - b[2]
    return Math.sqrt(dx * dx + dy * dy + dz * dz)
  }

  /** @param {string} guid @returns {[number, number, number]} */
  _position (guid) {
    const intent = projectGraph.getEffectiveIntent(guid)
    const pos = /** @type {unknown} */ (
      intent && typeof intent === 'object' && !Array.isArray(intent)
        ? /** @type {Record<string, unknown>} */ (intent).position
        : null
    )
    if (Array.isArray(pos) && pos.length === 3) {
      return [Number(pos[0]), Number(pos[1]), Number(pos[2])]
    }
    return [0, 0, 0]
  }

  /** @param {string} guid @returns {string} */
  _intentLabel (guid) {
    const intent = projectGraph.getEffectiveIntent(guid)
    const n = intentName(intent)
    return n || guid
  }
}
