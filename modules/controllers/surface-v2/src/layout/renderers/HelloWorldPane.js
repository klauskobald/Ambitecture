export class HelloWorldPane {
  /**
   * @param {string} [paneId]
   */
  constructor (paneId) {
    this._paneId = paneId ?? ''
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.classList.add('layout-hello-pane')
    container.textContent = this._paneId
      ? `Hello world — ${this._paneId}`
      : 'Hello world'
  }
}
