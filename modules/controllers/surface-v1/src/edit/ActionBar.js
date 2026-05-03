export class ActionBar {
  /**
   * @param {{ onModify: () => void, onCopy: () => void, onDelete: () => void }} callbacks
   */
  constructor ({ onModify, onCopy, onDelete }) {
    this._onModify = onModify
    this._onCopy = onCopy
    this._onDelete = onDelete
    /** @type {HTMLButtonElement | null} */
    this._modifyBtn = null
    /** @type {HTMLButtonElement | null} */
    this._copyBtn = null
    /** @type {HTMLButtonElement | null} */
    this._deleteBtn = null
    /** @type {HTMLElement | null} */
    this._el = null
  }

  /** @returns {HTMLElement} */
  buildElement () {
    this._el = document.createElement('div')
    this._el.className = 'action-bar'
    this._el.style.display = 'none'

    this._modifyBtn = document.createElement('button')
    this._modifyBtn.className = 'btn action-bar__btn'
    this._modifyBtn.textContent = 'Modify'
    this._modifyBtn.addEventListener('click', () => this._onModify())

    this._copyBtn = document.createElement('button')
    this._copyBtn.className = 'btn action-bar__btn'
    this._copyBtn.textContent = 'Copy'
    this._copyBtn.disabled = true
    this._copyBtn.addEventListener('click', () => this._onCopy())

    this._deleteBtn = document.createElement('button')
    this._deleteBtn.className = 'btn action-bar__btn btn--danger'
    this._deleteBtn.textContent = 'Delete'
    this._deleteBtn.disabled = true
    this._deleteBtn.addEventListener('click', () => this._onDelete())

    this._el.appendChild(this._modifyBtn)
    this._el.appendChild(this._copyBtn)
    this._el.appendChild(this._deleteBtn)

    return this._el
  }

  /**
   * @param {number} size
   * @param {boolean} selectModeActive — multi-select mode is on (Select toolbar button)
   */
  refresh (size, selectModeActive) {
    if (!this._el) return
    const show = selectModeActive && size > 0
    this._el.style.display = show ? '' : 'none'
    if (this._deleteBtn) this._deleteBtn.disabled = size === 0
    if (this._copyBtn) this._copyBtn.disabled = size === 0
  }
}
