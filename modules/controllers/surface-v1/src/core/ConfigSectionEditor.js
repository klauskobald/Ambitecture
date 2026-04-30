import { ConfigManager } from './ConfigManager.js'

/**
 * @typedef {object} ConfigSectionEditorOptions
 * @property {string} title                                              section heading
 * @property {() => string[]} getItems                                  list items
 * @property {(name: string) => void} onActivate
 * @property {(name: string) => void} [onAdd]
 * @property {(name: string) => void} [onRemove]
 * @property {(container: HTMLElement, activeName: string | null) => void} renderSection
 */

export class ConfigSectionEditor {
  /** @param {ConfigSectionEditorOptions} options */
  constructor (options) {
    this._options = options

    this._el = document.createElement('div')
    this._el.className = 'config-section-editor'

    const header = document.createElement('div')
    header.className = 'config-section-editor__header'
    header.textContent = options.title
    this._el.appendChild(header)

    this._manager = new ConfigManager({
      collectionName: options.title,
      getItems: options.getItems,
      renderItem: (name, li) => {
        const label = document.createElement('span')
        label.textContent = name
        li.appendChild(label)
      },
      onActivate: (name) => {
        options.onActivate(name)
        this._renderSection()
      },
      onAdd: (name) => options.onAdd?.(name),
      onRemove: (name) => options.onRemove?.(name),
    })
    this._manager.mount(this._el)

    this._body = document.createElement('div')
    this._body.className = 'config-section-editor__body'
    this._el.appendChild(this._body)
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.appendChild(this._el)
  }

  refresh () {
    this._manager.refresh()
    this._renderSection()
  }

  /** @param {string} name */
  setActive (name) {
    this._manager.setActive(name)
  }

  /** @returns {string | null} */
  getActive () {
    return this._manager.getActive()
  }

  _renderSection () {
    this._options.renderSection(this._body, this._manager.getActive())
  }
}
