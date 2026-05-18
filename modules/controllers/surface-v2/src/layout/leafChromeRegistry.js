/**
 * Optional per-pane hooks for extra chrome (e.g. stage-edit mode bar).
 * LayoutManager only calls these adapters.
 */

/**
 * @typedef {object} LeafChromeAdapter
 * @property {string} ownerPaneId
 * @property {string} [bodyClass] extra class on .layout-leaf-body when present
 * @property {string} [chromeUnderMountPaneId] append chrome below this pane mount (not under leaf header)
 * @property {(leafEl: HTMLElement, paneIds: string[]) => HTMLElement} createRow
 * @property {(activePaneId: string) => boolean} isChromeVisible
 * @property {(activePaneId: string, mountPaneId: string, paneIds: string[]) => boolean} keepMountVisible
 * @property {(chromeRowEl: HTMLElement) => import('./paneRendererRegistry.js').PaneRenderer} getRenderer
 * @property {() => void} [onLayoutRebuild] after layout tree rebuild
 */

/** @type {Map<string, LeafChromeAdapter>} */
const adaptersByOwnerPane = new Map()

/**
 * @param {LeafChromeAdapter} adapter
 */
export function registerLeafChrome (adapter) {
  adaptersByOwnerPane.set(adapter.ownerPaneId, adapter)
}

/**
 * @param {string[]} paneIds
 * @returns {LeafChromeAdapter | null}
 */
export function resolveLeafChrome (paneIds) {
  for (const id of paneIds) {
    const adapter = adaptersByOwnerPane.get(id)
    if (adapter && paneIds.includes(adapter.ownerPaneId)) return adapter
  }
  return null
}

export function notifyLeafChromeLayoutRebuild () {
  for (const adapter of adaptersByOwnerPane.values()) {
    adapter.onLayoutRebuild?.()
  }
}
