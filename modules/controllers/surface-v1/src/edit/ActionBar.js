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
    /** @type {HTMLElement | null} */
    this._el = null
  }

  /** @returns {HTMLElement} */
  buildElement () {
    this._el = document.createElement('div')
    this._el.className = 'action-bar'
    this._el.hidden = true

    this._modifyBtn = document.createElement('button')
    this._modifyBtn.className = 'btn action-bar__btn'
    this._modifyBtn.textContent = 'Modify'
    this._modifyBtn.addEventListener('click', () => this._onModify())

    const copyBtn = document.createElement('button')
    copyBtn.className = 'btn action-bar__btn'
    copyBtn.textContent = 'Copy'
    copyBtn.disabled = true
    copyBtn.addEventListener('click', () => this._onCopy())

    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'btn action-bar__btn btn--danger'
    deleteBtn.textContent = 'Delete'
    deleteBtn.disabled = true
    deleteBtn.addEventListener('click', () => this._onDelete())

    this._el.appendChild(this._modifyBtn)
    this._el.appendChild(copyBtn)
    this._el.appendChild(deleteBtn)

    return this._el
  }

  /** @param {number} size */
  refresh (size) {
    if (!this._el || !this._modifyBtn) return
    this._el.hidden = size === 0
    this._modifyBtn.disabled = size === 0
  }
}
