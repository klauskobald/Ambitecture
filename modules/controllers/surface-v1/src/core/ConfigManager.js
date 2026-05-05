import { confirm as modalConfirm, prompt as modalPrompt } from './Modal.js'

/**
 * Generic manager for named collections (scenes, sequences, actions).
 *
 * Provides list rendering, add/remove, selection, and activation.
 * Each use case supplies its own `renderItem`, `onActivate`, `onAdd`, `onRemove`.
 *
 * @typedef {object} ConfigManagerOptions
 * @property {string} collectionName            e.g. "Scene", "Sequence"
 * @property {() => string[]} getItems          returns list of item names
 * @property {(name: string, li: HTMLElement, manager: ConfigManager) => void} renderItem
 * @property {(name: string) => void} onActivate
 * @property {(name: string) => void} onAdd
 * @property {(name: string) => void} onRemove
 */

export class ConfigManager {
  /** @param {ConfigManagerOptions} options */
  constructor (options) {
    this._options = options
    /** @type {string | null} */
    this._activeName = null

    this._el = document.createElement('div')
    this._el.className = 'config-manager'

    this._toolbarEl = document.createElement('div')
    this._toolbarEl.className = 'config-manager-toolbar'

    this._titleEl = document.createElement('span')
    this._titleEl.className = 'config-manager-title'
    this._titleEl.textContent = options.collectionName

    this._addBtn = document.createElement('button')
    this._addBtn.className = 'btn'
    this._addBtn.textContent = '+ ' + options.collectionName
    this._addBtn.addEventListener('click', () => this._onAddClick())

    this._toolbarEl.appendChild(this._titleEl)
    this._toolbarEl.appendChild(this._addBtn)

    this._listEl = document.createElement('ul')
    this._listEl.className = 'config-manager-list'

    this._el.appendChild(this._toolbarEl)
    this._el.appendChild(this._listEl)
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.appendChild(this._el)
  }

  refresh () {
    this._listEl.innerHTML = ''
    const items = this._options.getItems()
    for (const name of items) {
      const li = document.createElement('li')
      li.className = 'config-manager-item'
      if (name === this._activeName) {
        li.classList.add('config-manager-item--active')
      }
      li.addEventListener('click', () => this.setActive(name))

      // Remove button (per item)
      const removeBtn = document.createElement('button')
      removeBtn.className = 'btn btn--sm'
      removeBtn.textContent = '×'
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this._onRemoveClick(name)
      })
      li.appendChild(removeBtn)

      this._options.renderItem(name, li, this)
      this._listEl.appendChild(li)
    }
  }

  /** @param {string | null} activeName */
  setActive (activeName) {
    if (activeName === null) {
      this._activeName = null
      this.refresh()
      return
    }
    this._activeName = activeName
    this._options.onActivate(activeName)
    this.refresh()
  }

  /**
   * Syncs the visual selection to `activeName` without firing `onActivate`.
   * Use when the active item changed externally (e.g. `graph:delta` / `projectPatch`).
   * @param {string | null} activeName
   */
  syncActive (activeName) {
    this._activeName = activeName
    this.refresh()
  }

  /** @returns {string | null} */
  getActive () {
    return this._activeName
  }

  async _onAddClick () {
    const values = await modalPrompt('', [
      { label: 'Name', key: 'name', placeholder: 'untitled' },
    ], { submit: 'Create' })
    if (values && values.name.trim()) {
      this._options.onAdd(values.name.trim())
      this.refresh()
    }
  }

  /** @param {string} name */
  async _onRemoveClick (name) {
    const ok = await modalConfirm(
      `Remove ${this._options.collectionName.toLowerCase()} "${name}"?`,
      { yes: 'Remove', no: 'Cancel' },
    )
    if (ok) {
      this._options.onRemove(name)
      if (this._activeName === name) {
        this._activeName = null
      }
      this.refresh()
    }
  }
}
