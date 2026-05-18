import * as statusDisplay from '../app/statusDisplay.js'

/**
 * @typedef {import('./loadLayoutCatalog.js').LayoutPane} LayoutPane
 */

/**
 * @typedef {object} PaneRenderer
 * @property {(container: HTMLElement) => void} mount
 * @property {() => void} [willBeDeactivated]
 * @property {() => void} [deactivate]
 * @property {() => void} [willBeActivated]
 * @property {() => void} [activate]
 */

/**
 * @typedef {new (...args: unknown[]) => PaneRenderer} PaneRendererConstructor
 */

/**
 * @typedef {object} PaneRendererRegistration
 * @property {PaneRendererConstructor} Renderer
 * @property {(args: string[]) => PaneRenderer} create
 */

/** @type {Map<string, PaneRendererRegistration>} */
const registry = new Map()

/**
 * @param {string} kind
 * @param {PaneRendererConstructor} Renderer
 * @param {(args: string[]) => PaneRenderer} [create]
 */
export function registerPaneRenderer (kind, Renderer, create) {
  registry.set(kind, {
    Renderer,
    create: create ?? (() => new Renderer())
  })
}

/**
 * @param {LayoutPane} pane
 * @returns {PaneRenderer}
 */
export function createPaneRenderer (pane) {
  const entry = registry.get(pane.class)
  if (!entry) {
    statusDisplay.error(
      `No pane renderer registered for class "${pane.class}" (pane "${pane.id}").`,
      'layout'
    )
    throw new Error(`No pane renderer for class "${pane.class}"`)
  }
  return entry.create(pane.args)
}
