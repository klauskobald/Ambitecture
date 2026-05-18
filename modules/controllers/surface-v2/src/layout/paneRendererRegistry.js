import * as statusDisplay from '../app/statusDisplay.js'

/**
 * @typedef {object} PaneRenderer
 * @property {(container: HTMLElement) => void} mount
 * @property {() => void} [willBeDeactivated]
 * @property {() => void} [deactivate]
 * @property {() => void} [willBeActivated]
 * @property {() => void} [activate]
 */

/**
 * @typedef {object} PaneSpec
 * @property {string} kind renderer id (before `:` in catalog pane id)
 * @property {string | undefined} arg optional argument (after first `:`)
 */

/**
 * @typedef {(arg?: string) => PaneRenderer} PaneRendererFactory
 */

/** @type {Map<string, PaneRendererFactory>} */
const registry = new Map()

/** @type {Map<string, (arg: string | undefined) => string>} */
const tabLabelByKind = new Map()

/**
 * Split catalog pane ids: `plugin:midi-setup-1` → kind `plugin`, arg `midi-setup-1`.
 * @param {string} paneId
 * @returns {PaneSpec}
 */
export function parsePaneSpec (paneId) {
  const colon = paneId.indexOf(':')
  if (colon === -1) {
    return { kind: paneId, arg: undefined }
  }
  const kind = paneId.slice(0, colon)
  const arg = paneId.slice(colon + 1)
  if (!kind) {
    throw new Error(`Invalid pane id "${paneId}": empty kind before ":"`)
  }
  return { kind, arg: arg.length > 0 ? arg : undefined }
}

/**
 * @param {string} kind
 * @param {PaneRendererFactory} factory
 */
export function registerPaneRenderer (kind, factory) {
  registry.set(kind, factory)
}

/**
 * @param {string} kind
 * @param {(arg: string | undefined) => string} resolver
 */
export function registerPaneTabLabel (kind, resolver) {
  tabLabelByKind.set(kind, resolver)
}

/**
 * @param {string} paneId full catalog id (may include `kind:arg`)
 * @returns {string}
 */
export function getPaneTabLabel (paneId) {
  const { kind, arg } = parsePaneSpec(paneId)
  const resolver = tabLabelByKind.get(kind)
  if (resolver) return resolver(arg)
  return arg !== undefined ? `${kind}:${arg}` : kind
}

/**
 * @param {string} paneId full catalog id (may include `kind:arg`)
 * @returns {PaneRenderer}
 */
export function createPaneRenderer (paneId) {
  const { kind, arg } = parsePaneSpec(paneId)
  const factory = registry.get(kind)
  if (!factory) {
    statusDisplay.error(
      `No pane renderer registered for kind "${kind}" (pane "${paneId}").`,
      'layout'
    )
    throw new Error(`No pane renderer for kind "${kind}"`)
  }
  return factory(arg)
}
