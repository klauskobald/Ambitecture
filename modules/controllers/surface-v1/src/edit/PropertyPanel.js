import { SliderControl } from './controls/SliderControl.js'
import { ColorControl } from './controls/ColorControl.js'
import { PillControl } from './controls/PillControl.js'
import { ModalControl } from './controls/ModalControl.js'

export class PropertyPanel {
  /**
   * @param {unknown[]} descriptors  resolved descriptor list from systemCapabilities
   * @param {number} selectionSize
   */
  constructor (descriptors, selectionSize) {
    this._descriptors = descriptors
    this._selectionSize = selectionSize
    /** @type {import('./controls/PropertyControl.js').PropertyControl[]} */
    this._controls = []
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

    return panel
  }

  /**
   * Refresh all controls with the current guid set.
   * @param {Set<string>} guids
   */
  refresh (guids) {
    for (const control of this._controls) {
      control.refresh(guids)
    }
  }

  destroy () {
    for (const control of this._controls) {
      control.destroy()
    }
    this._controls = []
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
      default:
        return null
    }
  }
}
