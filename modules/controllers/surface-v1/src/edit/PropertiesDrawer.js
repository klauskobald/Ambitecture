import { PropertyPanel } from './PropertyPanel.js'
import { selectionState } from './selectionState.js'
import { projectGraph } from '../core/projectGraph.js'
import { intentName } from '../core/stores.js'

export class PropertiesDrawer {
  /**
   * @param {{ onAfterCloseSingleModify?: () => void }} [opts]
   */
  constructor (opts = {}) {
    this._onAfterCloseSingleModify = opts.onAfterCloseSingleModify ?? null
    /** @type {HTMLElement | null} */
    this._backdrop = null
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
    /** @type {(() => void) | null} */
    this._graphUnsub = null
    /** @type {number | null} */
    this._outsideCloserRaf = null
    this._onOutsidePointerDown = /** @param {PointerEvent} e */ (e) => {
      if (!this.isOpen() || !this._el) return
      const t = e.target
      if (t instanceof Node && this._el.contains(t)) return
      // Capture phase runs before modal buttons receive the event; treat modal UI as inert for closing.
      if (t instanceof Element) {
        const modal = t.closest('.modal-overlay')
        if (modal?.classList.contains('is-open')) return
      }
      this.close()
    }
  }

  mount () {
    this._backdrop = document.createElement('div')
    this._backdrop.className = 'prop-drawer-backdrop'
    this._backdrop.setAttribute('aria-hidden', 'true')

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
    document.body.appendChild(this._backdrop)
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
    this._backdrop?.classList.add('is-open')
    this._backdrop?.setAttribute('aria-hidden', 'false')
    this._el.classList.add('is-open')

    if (this._outsideCloserRaf != null) {
      cancelAnimationFrame(this._outsideCloserRaf)
    }
    this._outsideCloserRaf = requestAnimationFrame(() => {
      this._outsideCloserRaf = null
      if (!this.isOpen()) return
      document.addEventListener('pointerdown', this._onOutsidePointerDown, true)
    })

    if (!this._selectionUnsub) {
      this._selectionUnsub = selectionState.subscribe(() => this._onSelectionChange())
    }
    if (!this._graphUnsub) {
      this._graphUnsub = projectGraph.subscribe(() => this._onProjectGraphChange())
    }
  }

  close () {
    if (!this._el) return
    const hadSingleModifyTarget = this._currentGuids.size === 1
    if (this._outsideCloserRaf != null) {
      cancelAnimationFrame(this._outsideCloserRaf)
      this._outsideCloserRaf = null
    }
    document.removeEventListener('pointerdown', this._onOutsidePointerDown, true)
    this._backdrop?.classList.remove('is-open')
    this._backdrop?.setAttribute('aria-hidden', 'true')
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
    if (this._graphUnsub) {
      this._graphUnsub()
      this._graphUnsub = null
    }
    this._currentGuids = new Set()
    if (hadSingleModifyTarget) {
      selectionState.clearAll()
      this._onAfterCloseSingleModify?.()
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
    this._refreshTitle()

    this._panel = new PropertyPanel(this._lastDescriptors, size, guids)
    this._body.appendChild(this._panel.buildElement())
    this._panel.refresh(guids)
  }

  _refreshTitle () {
    if (!this._title) return
    const guids = this._currentGuids
    const size = guids.size
    if (size === 0) return
    if (size === 1) {
      const [g] = [...guids]
      const intent = projectGraph.getEffectiveIntent(g)
      const n = intentName(intent)
      this._title.textContent = n ? `Modify: ${n}` : `Modify: ${g}`
      return
    }
    this._title.textContent = `Modifying ${size} intents`
  }

  _onProjectGraphChange () {
    if (!this.isOpen() || !this._panel) return
    const guids = selectionState.getGuids()
    if (guids.size === 0) {
      this.close()
      return
    }
    this._currentGuids = guids
    this._panel.refresh(guids)
    this._refreshTitle()
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
