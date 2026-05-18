import { loadLayoutCatalog } from '../layout/loadLayoutCatalog.js'
import { LayoutManager } from '../layout/LayoutManager.js'
import { registerPaneRenderer } from '../layout/paneRendererRegistry.js'
import { HelloWorldPane } from '../layout/renderers/HelloWorldPane.js'

/** @type {string[]} */
const PANE_IDS = [
  'simulator-2d',
  'control',
  'pulse',
  'animation',
  'plugins'
]

async function main () {
  for (const paneId of PANE_IDS) {
    registerPaneRenderer(paneId, () => new HelloWorldPane(paneId))
  }

  const catalog = await loadLayoutCatalog()
  if (!catalog) return

  const toolbar = document.getElementById('layout-toolbar')
  const stage = document.getElementById('layout-stage')
  if (!toolbar || !stage) {
    console.error('Missing #layout-toolbar or #layout-stage')
    return
  }

  LayoutManager.init({
    toolbar,
    stage,
    catalog,
    defaultLayoutId: '2cols'
  })

  window.LayoutManager = LayoutManager
}

main()
