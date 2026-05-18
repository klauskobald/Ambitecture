export class SimulatorViewport {
  /**
   * @param {HTMLIFrameElement} iframe
   */
  constructor (iframe) {
    this._iframe = iframe
  }

  /**
   * Returns the bounding rect of the simulator's #sim-canvas in page coordinates.
   * The sim-canvas lives inside the iframe's document; we offset by the iframe's
   * own position to get page-level coords usable alongside the overlay canvas rect.
   * @returns {DOMRect | null}
   */
  getSimCanvasRect () {
    const simCanvas = this._iframe.contentDocument?.getElementById('sim-canvas')
    if (!simCanvas) return null
    const inner = simCanvas.getBoundingClientRect()
    const outer = this._iframe.getBoundingClientRect()
    return new DOMRect(
      outer.left + inner.left,
      outer.top + inner.top,
      inner.width,
      inner.height
    )
  }

  /** @param {string} src */
  setSrc (src) {
    this._iframe.src = src
  }
}
