import { PropertyPanel } from './PropertyPanel.js'
import { selectionState } from './selectionState.js'

export class PropertiesDrawer {
  constructor () {
    /** @type {HTMLElement | null} */
    this._el = null
    /** @type {HTMLElement | null} */
    this._body = null
    /** @type {HTMLElement | null} */
    this._title = null
    /** @type {PropertyPanel | null} */
    this._panel = null
    /** @type {Set<string>} */
    this._currentGuids = new Set()
    /** @type {unknown[]} */
    this._lastDescriptors = []
    /** @type {(() => void) | null} */
    this._selectionUnsub = null
  }

  mount () {
    this._el = document.createElement('div')
    this._el.className = 'prop-drawer'

    const header = document.createElement('div')
    header.className = 'prop-drawer__header'

    this._title = document.createElement('span')
    this._title.className = 'prop-drawer__title'

    const closeBtn = document.createElement('button')
    closeBtn.className = 'btn prop-drawer__close'
    closeBtn.setAttribute('aria-label', 'Close')
    closeBtn.textContent = '×'
    closeBtn.addEventListener('click', () => this.close())

    header.appendChild(this._title)
    header.appendChild(closeBtn)

    this._body = document.createElement('div')
    this._body.className = 'prop-drawer__body'

    this._el.appendChild(header)
    this._el.appendChild(this._body)
    document.body.appendChild(this._el)
  }

  /**
   * @param {unknown[]} descriptors
   * @param {Set<string>} guids
   */
  open (descriptors, guids) {
    if (!this._el) return
    this._lastDescriptors = descriptors
    this._rebuildPanel(guids)
    this._el.classList.add('is-open')

    if (!this._selectionUnsub) {
      this._selectionUnsub = selectionState.subscribe(() => this._onSelectionChange())
    }
  }

  close () {
    if (!this._el) return
    this._el.classList.remove('is-open')
    if (this._panel) {
      this._panel.destroy()
      this._panel = null
    }
    if (this._body) this._body.innerHTML = ''
    if (this._selectionUnsub) {
      this._selectionUnsub()
      this._selectionUnsub = null
    }
  }

  /** @returns {boolean} */
  isOpen () {
    return this._el?.classList.contains('is-open') ?? false
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /** @param {Set<string>} guids */
  _rebuildPanel (guids) {
    if (!this._body || !this._title) return

    if (this._panel) {
      this._panel.destroy()
      this._body.innerHTML = ''
    }

    this._currentGuids = guids
    const size = guids.size
    this._title.textContent = `Modifying ${size} intent${size === 1 ? '' : 's'}`

    this._panel = new PropertyPanel(this._lastDescriptors, size)
    this._body.appendChild(this._panel.buildElement())
    this._panel.refresh(guids)
  }

  _onSelectionChange () {
    const guids = selectionState.getGuids()
    if (guids.size === 0) {
      this.close()
      return
    }
    this._rebuildPanel(guids)
  }
}
