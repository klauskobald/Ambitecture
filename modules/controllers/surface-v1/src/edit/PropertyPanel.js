import { SliderControl } from './controls/SliderControl.js'
import { ColorControl } from './controls/ColorControl.js'
import { PillControl } from './controls/PillControl.js'
import { ModalControl } from './controls/ModalControl.js'
import { InfoTextControl } from './controls/InfoTextControl.js'
import { projectGraph } from '../core/projectGraph.js'
import { InputAssignManager } from './InputAssignManager.js'

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
  }

  destroy () {
    for (const control of this._controls) {
      control.destroy()
    }
    this._controls = []
    this._inputAssignManager = null
  }

  /** @returns {HTMLElement | null} */
  _buildAssignSection () {
    if (this._selectionSize !== 1) return null
    const [guid] = [...this._selectedGuids]
    if (!guid || !projectGraph.getIntents().has(guid)) return null
    const intent = projectGraph.getEffectiveIntent(guid)
    const intentName = typeof intent?.name === 'string' ? intent.name : guid
    this._inputAssignManager = new InputAssignManager({
      targetType: 'intent',
      targetGuid: guid,
      targetName: intentName,
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
