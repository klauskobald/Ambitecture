import { SliderControl } from './controls/SliderControl.js'
import { ColorControl } from './controls/ColorControl.js'
import { PillControl } from './controls/PillControl.js'
import { ModalControl } from './controls/ModalControl.js'
import { InfoTextControl } from './controls/InfoTextControl.js'
import { Vector3BooleanControl } from './controls/Vector3BooleanControl.js'
import { projectGraph } from '../core/projectGraph.js'
import {
  queueIntentUpdate,
  sendSaveProject
} from '../core/outboundQueue.js'
import { InputAssignManager } from './InputAssignManager.js'
import {
  effectivePerformResetForKey
} from '../core/intentPerformDefaults.js'
import { intentHeightSliderEnabled } from '../core/stores.js'
import { getStageOverlay } from '../stage/stageOverlayHost.js'
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
    /** @type {HTMLButtonElement | null} */
    this._heightSliderPill = null
  }

  /**
   * Build and return the panel root element.
   * @returns {HTMLElement}
   */
  buildElement () {
    const panel = document.createElement('div')
    panel.className = 'prop-panel'

    for (const descriptor of this._descriptors) {
      const d = /** @type {Record<string, unknown>} */ (descriptor)
      if (d.noMultiple && this._selectionSize > 1) continue

      const control = this._controlForDescriptor(d)
      if (!control) continue

      this._controls.push(control)
      panel.appendChild(control.buildRow())
    }

    const togglesCard = this._buildBottomTogglesCard()
    if (togglesCard) {
      panel.appendChild(togglesCard)
    }

    return panel
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
    this._refreshHeightSliderPill()
  }

  destroy () {
    for (const control of this._controls) {
      control.destroy()
    }
    this._controls = []
    this._inputAssignManager = null
    this._performResetToggleByKey = null
    this._heightSliderPill = null
  }

  /**
   * Merged bottom card: input-assign pill + one pill per perform-reset key.
   * No heading; pills lay out horizontally.
   * @returns {HTMLElement | null}
   */
  _buildBottomTogglesCard () {
    this._inputAssignManager = null
    this._performResetToggleByKey = null
    this._heightSliderPill = null
    if (this._selectionSize !== 1) return null
    const [guid] = [...this._selectedGuids]
    if (!guid || !projectGraph.getIntents().has(guid)) return null

    const card = document.createElement('div')
    card.className = 'prop-row prop-row--bottom-toggles'
    const pills = document.createElement('div')
    pills.className = 'prop-pills prop-pills--bottom-toggles'
    card.appendChild(pills)

    const intent = projectGraph.getEffectiveIntent(guid)
    const intentLabel = typeof intent?.name === 'string' ? intent.name : guid
    this._inputAssignManager = new InputAssignManager({
      context: { type: 'intent', guid },
      labelDefault: intentLabel
    })
    pills.appendChild(this._inputAssignManager.getStatePill())

    this._heightSliderPill = this._buildHeightSliderPill(guid)
    pills.appendChild(this._heightSliderPill)
    this._refreshHeightSliderPill()

    this._performResetToggleByKey = this._buildPerformResetPills(guid, pills)
    return card
  }

  /**
   * Toggle the stage height (Y) slider for this intent. Persists an explicit `heightSlider`
   * boolean (default-on for targets, off otherwise — see {@link intentHeightSliderEnabled}).
   * @param {string} guid
   * @returns {HTMLButtonElement}
   */
  _buildHeightSliderPill (guid) {
    const pill = document.createElement('button')
    pill.type = 'button'
    pill.className = 'prop-pill intent-toggle'
    pill.textContent = 'Height slider'
    pill.title = 'Toggle the Y-height slider on the stage'
    pill.addEventListener('click', () => {
      const current =
        projectGraph.getEffectiveIntent(guid) ?? projectGraph.getIntents().get(guid)
      const eff = intentHeightSliderEnabled(current)
      const updated = projectGraph.updateIntentProperty(guid, 'heightSlider', !eff)
      if (updated) queueIntentUpdate(updated)
      sendSaveProject('intents', [...projectGraph.getIntents().values()])
      this._refreshHeightSliderPill()
      getStageOverlay()?.markRenderActivity()
    })
    return pill
  }

  _refreshHeightSliderPill () {
    if (!this._heightSliderPill || this._selectionSize !== 1) return
    const [guid] = [...this._selectedGuids]
    if (!guid) return
    const intent =
      projectGraph.getEffectiveIntent(guid) ?? projectGraph.getIntents().get(guid)
    const eff = intentHeightSliderEnabled(intent)
    this._heightSliderPill.classList.toggle('prop-pill--active', eff)
    this._heightSliderPill.classList.toggle('intent-toggle--enabled', eff)
    this._heightSliderPill.setAttribute('aria-pressed', eff ? 'true' : 'false')
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
