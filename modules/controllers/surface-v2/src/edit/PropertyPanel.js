import { SliderControl } from './controls/SliderControl.js'
import { ColorControl } from './controls/ColorControl.js'
import { PillControl } from './controls/PillControl.js'
import { ModalControl } from './controls/ModalControl.js'
import { InfoTextControl } from './controls/InfoTextControl.js'
import { Vector3BooleanControl } from './controls/Vector3BooleanControl.js'
import { BooleanPillControl } from './controls/BooleanPillControl.js'
import { projectGraph } from '../core/projectGraph.js'
import {
  queueIntentUpdate,
  sendSaveProject
} from '../core/outboundQueue.js'
import { InputAssignManager } from './InputAssignManager.js'
import {
  effectivePerformResetForKey
} from '../core/intentPerformDefaults.js'
import { resolveIntentDescriptorUiKind } from '../core/systemCapabilities.js'
import { PERFORM_RESET_KEY_METAS } from './performResetKeyMetas.js'

export class PropertyPanel {
  /**
   * @param {unknown[]} descriptors  resolved descriptor list from systemCapabilities
   * @param {number} selectionSize
   * @param {Set<string>} [selectedGuids]
   * @param {import('./controls/PropertyControl.js').PropertyControl['_writeTarget']} [writeTarget]
   *   optional entity write target (fixtures); intents use the default path when omitted.
   */
  constructor (descriptors, selectionSize, selectedGuids = new Set(), writeTarget = null) {
    this._descriptors = descriptors
    this._selectionSize = selectionSize
    this._selectedGuids = selectedGuids
    this._writeTarget = writeTarget
    /** @type {import('./controls/PropertyControl.js').PropertyControl[]} */
    this._controls = []
    /** @type {InputAssignManager | null} */
    this._inputAssignManager = null
    /** @type {Map<string, HTMLButtonElement> | null} */
    this._performResetToggleByKey = null
  }

  /**
   * Build and return the panel root element.
   * @returns {HTMLElement}
   */
  buildElement () {
    const panel = document.createElement('div')
    panel.className = 'prop-panel'

    /**
     * Descriptors with a `host` are not their own card — they pool into the card named by that id.
     * `misc-settings` is the shared card that also carries the Input + Scene-switch pills.
     * @type {Map<string, Record<string, unknown>[]>}
     */
    const hostGroups = new Map()
    if (this._isSingleIntentSelection()) hostGroups.set('misc-settings', [])

    for (const descriptor of this._descriptors) {
      const d = /** @type {Record<string, unknown>} */ (descriptor)
      if (d.noMultiple && this._selectionSize > 1) continue

      const host = typeof d.host === 'string' && d.host.length > 0 ? d.host : null
      if (host) {
        if (!hostGroups.has(host)) hostGroups.set(host, [])
        const group = /** @type {Record<string, unknown>[]} */ (hostGroups.get(host))
        group.push(d)
        continue
      }

      const control = this._controlForDescriptor(d)
      if (!control) continue
      this._controls.push(control)
      panel.appendChild(control.buildRow())
    }

    for (const [hostId, descriptors] of hostGroups) {
      const card = this._buildHostCard(hostId, descriptors)
      if (card) panel.appendChild(card)
    }

    return panel
  }

  /** @returns {boolean} */
  _isSingleIntentSelection () {
    if (this._selectionSize !== 1) return false
    const [guid] = [...this._selectedGuids]
    return !!guid && projectGraph.getIntents().has(guid)
  }

  /**
   * Refresh all controls with the current guid set.
   * @param {Set<string>} guids
   */
  refresh (guids) {
    this._selectedGuids = guids
    this._inputAssignManager?.refresh()
    for (const control of this._controls) {
      control.refresh(guids)
    }
    this._refreshPerformResetPills()
  }

  destroy () {
    for (const control of this._controls) {
      control.destroy()
    }
    this._controls = []
    this._inputAssignManager = null
    this._performResetToggleByKey = null
  }

  /**
   * Shared host card: a single title-less card holding pills. `misc-settings` additionally carries
   * the Input + Scene-switch pills. Returns null when the card would be empty.
   * @param {string} hostId
   * @param {Record<string, unknown>[]} descriptors
   * @returns {HTMLElement | null}
   */
  _buildHostCard (hostId, descriptors) {
    const card = document.createElement('div')
    card.className = 'prop-row prop-row--host'
    card.dataset.host = hostId
    const pills = document.createElement('div')
    pills.className = 'prop-pills prop-pills--host'
    card.appendChild(pills)

    if (hostId === 'misc-settings') this._appendMiscSettingsPills(pills)

    for (const d of descriptors) {
      const control = this._buildHostControl(d)
      if (!control) continue
      this._controls.push(control)
      pills.appendChild(control.buildPill())
      control.refresh(this._selectedGuids)
    }

    return pills.childElementCount > 0 ? card : null
  }

  /** Input-assign pill + one pill per perform-reset key (single-intent only), into a host pill row. */
  _appendMiscSettingsPills (pills) {
    this._inputAssignManager = null
    this._performResetToggleByKey = null
    if (!this._isSingleIntentSelection()) return
    const [guid] = [...this._selectedGuids]
    if (!guid) return
    const intent = projectGraph.getEffectiveIntent(guid)
    const intentLabel = typeof intent?.name === 'string' ? intent.name : guid
    this._inputAssignManager = new InputAssignManager({
      context: { type: 'intent', guid },
      labelDefault: intentLabel
    })
    pills.appendChild(this._inputAssignManager.getStatePill())
    this._performResetToggleByKey = this._buildPerformResetPills(guid, pills)
  }

  /**
   * @param {Record<string, unknown>} d
   * @returns {BooleanPillControl | null}
   */
  _buildHostControl (d) {
    if (resolveIntentDescriptorUiKind(d) !== 'pill') return null
    return new BooleanPillControl(d, () => {}, this._selectionSize, this._writeTarget)
  }

  /**
   * @param {string} guid
   * @param {HTMLElement} container
   * @returns {Map<string, HTMLButtonElement>}
   */
  _buildPerformResetPills (guid, container) {
    const intent = projectGraph.getIntents().get(guid)
    /** @type {Set<string>} */
    const orderedKeys = new Set()
    for (const m of PERFORM_RESET_KEY_METAS) {
      orderedKeys.add(m.key)
    }
    const perform = intent?.perform && typeof intent.perform === 'object' && !Array.isArray(intent.perform)
      ? /** @type {Record<string, unknown>} */ (intent.perform)
      : null
    const reset = perform?.reset &&
      typeof perform.reset === 'object' &&
      !Array.isArray(perform.reset)
      ? /** @type {Record<string, unknown>} */ (perform.reset)
      : null
    const extraYaml = reset ? Object.keys(reset).sort() : []
    for (const k of extraYaml) {
      orderedKeys.add(k)
    }

    /** @type {Map<string, HTMLButtonElement>} */
    const toggles = new Map()
    for (const key of orderedKeys) {
      const dotKey = `perform.reset.${key}`
      const pill = document.createElement('button')
      pill.type = 'button'
      pill.className = 'prop-pill intent-toggle prop-pill--perform-reset-toggle'
      pill.textContent = this._labelForPerformResetKey(key)
      pill.title = 'Toggle perform reset'
      pill.addEventListener('click', () => {
        const intentRow = projectGraph.getIntents().get(guid)
        const eff = effectivePerformResetForKey(intentRow, key)
        const updated = projectGraph.updateIntentProperty(guid, dotKey, !eff)
        if (updated) queueIntentUpdate(updated)
        sendSaveProject('intents', [...projectGraph.getIntents().values()])
        this._refreshPerformResetPills()
      })
      container.appendChild(pill)
      toggles.set(key, pill)
    }
    return toggles
  }

  /** @param {string} key */
  _labelForPerformResetKey (key) {
    const meta = PERFORM_RESET_KEY_METAS.find(m => m.key === key)
    if (meta) return meta.title
    if (!key) return key
    return key.charAt(0).toUpperCase() + key.slice(1)
  }

  _refreshPerformResetPills () {
    if (!this._performResetToggleByKey || this._selectionSize !== 1) return
    const [guid] = [...this._selectedGuids]
    if (!guid) return
    const intent = projectGraph.getIntents().get(guid)
    for (const [key, btn] of this._performResetToggleByKey) {
      const eff = effectivePerformResetForKey(intent, key)
      btn.classList.toggle('prop-pill--active', eff === true)
      btn.classList.toggle('intent-toggle--enabled', eff === true)
      btn.setAttribute('aria-pressed', eff === true ? 'true' : 'false')
    }
  }

  /**
   * @param {Record<string, unknown>} d
   * @returns {import('./controls/PropertyControl.js').PropertyControl | null}
   */
  _controlForDescriptor (d) {
    const onCommit = () => {}
    const size = this._selectionSize
    const wt = this._writeTarget
    const kind = resolveIntentDescriptorUiKind(d)
    switch (kind) {
      case 'color':
        return new ColorControl(d, onCommit, size, wt)
      case 'scalar':
        return new SliderControl(d, onCommit, size, wt)
      case 'pills':
        return new PillControl(d, onCommit, size, wt)
      case 'string':
        return Array.isArray(d.options) && d.options.length > 0
          ? new PillControl(d, onCommit, size, wt)
          : new ModalControl(d, onCommit, size, wt)
      case 'vector3':
        return new InfoTextControl(d, onCommit, size, wt)
      case 'vector3Boolean':
        return new Vector3BooleanControl(d, onCommit, size, wt)
      default:
        return null
    }
  }
}
