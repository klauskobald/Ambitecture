class SelectionState {
  constructor () {
    /** @type {Set<string>} */
    this._guids = new Set()
    /** @type {Set<() => void>} */
    this._listeners = new Set()
  }

  /** @param {string} guid */
  toggleGuid (guid) {
    if (this._guids.has(guid)) {
      this._guids.delete(guid)
    } else {
      this._guids.add(guid)
    }
    this._notify()
  }

  clearAll () {
    if (this._guids.size === 0) return
    this._guids.clear()
    this._notify()
  }

  /** @param {string} guid @returns {boolean} */
  hasGuid (guid) { return this._guids.has(guid) }

  /** @returns {Set<string>} */
  getGuids () { return new Set(this._guids) }

  /** @returns {number} */
  getSize () { return this._guids.size }

  /** @param {() => void} fn @returns {() => void} unsubscribe */
  subscribe (fn) {
    this._listeners.add(fn)
    return () => this._listeners.delete(fn)
  }

  _notify () {
    for (const fn of this._listeners) fn()
  }
}

export const selectionState = new SelectionState()
