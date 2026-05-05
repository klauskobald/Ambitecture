import { SliderControl } from './controls/SliderControl.js'
import { ColorControl } from './controls/ColorControl.js'
import { PillControl } from './controls/PillControl.js'
import { ModalControl } from './controls/ModalControl.js'
import { InfoTextControl } from './controls/InfoTextControl.js'
import { projectGraph } from '../core/projectGraph.js'
import {
  queueIntentUpdate,
  sendSaveProject
} from '../core/outboundQueue.js'
import { InputAssignManager } from './InputAssignManager.js'
import {
  effectivePerformResetForKey
} from '../core/intentPerformDefaults.js'
import { PERFORM_RESET_KEY_METAS } from './performResetKeyMetas.js'

export class PropertyPanel {
  /**
   * @param {unknown[]} descriptors  resolved descriptor list from systemCapabilities
   * @param {number} selectionSize
   * @param {Set<string>} [selectedGuids]
   */
  constructor (descriptors, selectionSize, selectedGuids = new Set()) {
    this._descriptors = descriptors
    this._selectionSize = selectionSize
    this._selectedGuids = selectedGuids
    /** @type {import('./controls/PropertyControl.js').PropertyControl[]} */
    this._controls = []
    /** @type {InputAssignManager | null} */
    this._inputAssignManager = null
    /** @type {Map<string, { onBtn: HTMLButtonElement, offBtn: HTMLButtonElement }> | null} */
    this._performResetPillsByKey = null
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

    const assignSection = this._buildAssignSection()
    if (assignSection) {
      panel.appendChild(assignSection)
    }

    const performResetSection = this._buildPerformResetSection()
    if (performResetSection) {
      panel.appendChild(performResetSection)
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
  }

  destroy () {
    for (const control of this._controls) {
      control.destroy()
    }
    this._controls = []
    this._inputAssignManager = null
    this._performResetPillsByKey = null
  }

  /** @returns {HTMLElement | null} */
  _buildAssignSection () {
    if (this._selectionSize !== 1) return null
    const [guid] = [...this._selectedGuids]
    if (!guid || !projectGraph.getIntents().has(guid)) return null
    const intent = projectGraph.getEffectiveIntent(guid)
    const intentName = typeof intent?.name === 'string' ? intent.name : guid
    this._inputAssignManager = new InputAssignManager({
      context: { type: 'intent', guid },
      labelDefault: intentName,
    })
    const section = document.createElement('div')
    section.className = 'prop-row prop-row--assign'
    const header = document.createElement('div')
    header.className = 'prop-row__header'
    const label = document.createElement('span')
    label.className = 'prop-row__label'
    label.textContent = 'Input'
    header.appendChild(label)
    header.appendChild(this._inputAssignManager.getInvokeButton())
    section.appendChild(header)
    return section
  }

  /**
   * @returns {HTMLElement | null}
   */
  _buildPerformResetSection () {
    this._performResetPillsByKey = null
    if (this._selectionSize !== 1) return null
    const [guid] = [...this._selectedGuids]
    if (!guid || !projectGraph.getIntents().has(guid)) return null

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

    /** @type {Map<string, { onBtn: HTMLButtonElement, offBtn: HTMLButtonElement }>} */
    const pills = new Map()
    this._performResetPillsByKey = pills

    const wrap = document.createElement('section')
    wrap.className = 'prop-panel-section prop-panel-section--perform-reset'

    const groupHeader = document.createElement('div')
    groupHeader.className = 'prop-row prop-row--group-heading'
    const groupTitle = document.createElement('span')
    groupTitle.className = 'prop-row__label'
    groupTitle.textContent = 'Perform reset'
    groupHeader.appendChild(groupTitle)
    wrap.appendChild(groupHeader)

    for (const key of orderedKeys) {
      const dotKey = `perform.reset.${key}`
      const row = document.createElement('div')
      row.className = 'prop-row'

      const header = document.createElement('div')
      header.className = 'prop-row__header'
      const labelEl = document.createElement('span')
      labelEl.className = 'prop-row__label'
      labelEl.textContent = this._labelForPerformResetKey(key)
      header.appendChild(labelEl)
      row.appendChild(header)

      const controlArea = document.createElement('div')
      controlArea.className = 'prop-row__control'
      const group = document.createElement('div')
      group.className = 'prop-pills'

      /** @type {HTMLButtonElement} */
      let onBtn
      /** @type {HTMLButtonElement} */
      let offBtn

      /**
       * @param {boolean} value
       */
      const persist = value => {
        const updated = projectGraph.updateIntentProperty(guid, dotKey, value)
        if (updated) queueIntentUpdate(updated)
        sendSaveProject('intents', [...projectGraph.getIntents().values()])
      }

      for (const [labelText, boolVal] of [['On', true], ['Off', false]]) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'prop-pill intent-toggle'
        btn.textContent = labelText
        btn.dataset.value = String(boolVal)
        btn.addEventListener('click', () => {
          persist(boolVal)
          this._refreshPerformResetPills()
        })
        if (boolVal === true) onBtn = btn
        else offBtn = btn
        group.appendChild(btn)
      }

      pills.set(key, /** @type {{ onBtn: HTMLButtonElement, offBtn: HTMLButtonElement }} */ ({
        onBtn: /** @type {HTMLButtonElement} */ (onBtn),
        offBtn: /** @type {HTMLButtonElement} */ (offBtn),
      }))
      controlArea.appendChild(group)
      row.appendChild(controlArea)
      wrap.appendChild(row)
    }

    return wrap
  }

  /** @param {string} key */
  _labelForPerformResetKey (key) {
    const meta = PERFORM_RESET_KEY_METAS.find(m => m.key === key)
    if (meta) return meta.title
    if (!key) return key
    return key.charAt(0).toUpperCase() + key.slice(1)
  }

  _refreshPerformResetPills () {
    if (!this._performResetPillsByKey || this._selectionSize !== 1) return
    const [guid] = [...this._selectedGuids]
    if (!guid) return
    const intent = projectGraph.getIntents().get(guid)
    for (const [
      key,
      { onBtn, offBtn }
    ] of this._performResetPillsByKey) {
      const eff = effectivePerformResetForKey(intent, key)
      onBtn.classList.toggle('prop-pill--active', eff === true)
      onBtn.classList.toggle('intent-toggle--enabled', eff === true)
      offBtn.classList.toggle('prop-pill--active', eff === false)
      offBtn.classList.toggle('intent-toggle--enabled', eff === false)
    }
  }

  /**
   * @param {Record<string, unknown>} d
   * @returns {import('./controls/PropertyControl.js').PropertyControl | null}
   */
  _controlForDescriptor (d) {
    const onCommit = () => {}
    const size = this._selectionSize
    switch (d.type) {
      case 'color':
        return new ColorControl(d, onCommit, size)
      case 'scalar':
        return new SliderControl(d, onCommit, size)
      case 'string':
        return Array.isArray(d.options) && d.options.length > 0
          ? new PillControl(d, onCommit, size)
          : new ModalControl(d, onCommit, size)
      case 'infoText':
        return new InfoTextControl(d, onCommit, size)
      default:
        return null
    }
  }
}
