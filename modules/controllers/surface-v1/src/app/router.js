/**
 * Lazy-loading pane router with persistent pane instances.
 *
 * Panes are imported once on first navigation, mounted once in #pane-host-body,
 * and then shown/hidden via their activate()/deactivate() lifecycle methods.
 * Switching panes never tears down a mounted instance.
 *
 * @typedef {{ mount: (container: HTMLElement) => void, activate: () => void, deactivate: () => void }} Pane
 */

/** @type {Map<string, { instance: Pane | null }>} */
const paneCache = new Map()
/** @type {string | null} */
let activePaneName = null

/**
 * @param {import('../viewport/overlayCanvas.js').OverlayCanvas} overlay
 */
export function initRouter (overlay) {
  paneCache.set('perform', { instance: null })
  paneCache.set('edit', { instance: null })
  paneCache.set('scenes', { instance: null })

  // Stash overlay so factory functions can use it
  routerOverlay = overlay
}

/** @type {import('../viewport/overlayCanvas.js').OverlayCanvas | null} */
let routerOverlay = null

/**
 * @param {string} paneName
 * @returns {Promise<void>}
 */
export async function navigateTo (paneName) {
  const host = document.getElementById('pane-host-body')
  if (!host || !paneCache.has(paneName)) return

  // Deactivate current pane
  if (activePaneName && activePaneName !== paneName) {
    const current = paneCache.get(activePaneName)
    current?.instance?.deactivate()
  }

  activePaneName = paneName
  const entry = paneCache.get(paneName)
  if (!entry) return

  // Lazy-load and mount on first visit
  if (!entry.instance) {
    entry.instance = await createPane(paneName)
    entry.instance.mount(host)
  }

  entry.instance.activate()
}

/**
 * @param {string} paneName
 * @returns {Promise<Pane>}
 */
async function createPane (paneName) {
  const overlay = routerOverlay
  if (!overlay) throw new Error('Router not initialized — call initRouter first.')

  switch (paneName) {
    case 'perform': {
      const { PerformPane } = await import('../panes/performPane.js')
      return new PerformPane(overlay)
    }
    case 'edit': {
      const { EditPane } = await import('../panes/editPane.js')
      return new EditPane(overlay)
    }
    case 'scenes': {
      const { ScenesPane } = await import('../panes/scenesPane.js')
      return new ScenesPane()
    }
    default:
      throw new Error(`Unknown pane: ${paneName}`)
  }
}
