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
 * @typedef {new (arg?: string) => PaneRenderer} PaneRendererConstructor
 */

/**
 * @typedef {object} PaneRendererRegistration
 * @property {PaneRendererConstructor} Renderer
 * @property {(arg?: string) => PaneRenderer} create
 */

/** @type {Map<string, PaneRendererRegistration>} */
const registry = new Map()

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
 * @param {PaneRendererConstructor} Renderer
 * @param {(arg?: string) => PaneRenderer} [create]
 */
export function registerPaneRenderer (kind, Renderer, create) {
  registry.set(kind, {
    Renderer,
    create: create ?? (() => new Renderer())
  })
}

/**
 * @param {string} paneId full catalog id (may include `kind:arg`)
 * @returns {string}
 */
export function getButtonLabel (paneId) {
  const { kind, arg } = parsePaneSpec(paneId)
  const entry = registry.get(kind)
  if (
    entry &&
    typeof entry.Renderer.getButtonLabel === 'function'
  ) {
    return entry.Renderer.getButtonLabel(arg)
  }
  return arg !== undefined ? `${kind}:${arg}` : kind
}

/**
 * @param {string} paneId full catalog id (may include `kind:arg`)
 * @returns {PaneRenderer}
 */
export function createPaneRenderer (paneId) {
  const { kind, arg } = parsePaneSpec(paneId)
  const entry = registry.get(kind)
  if (!entry) {
    statusDisplay.error(
      `No pane renderer registered for kind "${kind}" (pane "${paneId}").`,
      'layout'
    )
    throw new Error(`No pane renderer for kind "${kind}"`)
  }
  return entry.create(arg)
}
