import * as statusDisplay from '../app/statusDisplay.js'

/**
 * @typedef {object} PaneRenderer
 * @property {(container: HTMLElement) => void} mount
 * @property {() => void} [activate]
 * @property {() => void} [deactivate]
 */

/** @type {Map<string, () => PaneRenderer>} */
const registry = new Map()

/**
 * @param {string} paneId
 * @param {() => PaneRenderer} factory
 */
export function registerPaneRenderer (paneId, factory) {
  registry.set(paneId, factory)
}

/**
 * @param {string} paneId
 * @returns {PaneRenderer}
 */
export function createPaneRenderer (paneId) {
  const factory = registry.get(paneId)
  if (!factory) {
    statusDisplay.error(`No pane renderer registered for "${paneId}".`, 'layout')
    throw new Error(`No pane renderer for "${paneId}"`)
  }
  return factory()
}
