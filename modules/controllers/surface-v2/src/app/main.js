import { loadAppConfig } from './config.js'
import { LayoutManager } from '../layout/LayoutManager.js'
import { registerPaneRenderer } from '../layout/paneRendererRegistry.js'
import { HelloWorldPane } from '../layout/renderers/HelloWorldPane.js'
import { Simulator2dPane } from '../layout/renderers/Simulator2dPane.js'

/** @type {string[]} */
const PLACEHOLDER_PANE_IDS = ['control', 'pulse', 'animation', 'plugins']

async function main () {
  const appCfg = await loadAppConfig()
  if (!appCfg) return

  registerPaneRenderer(
    'simulator-2d',
    () => new Simulator2dPane(appCfg.simulatorIframeUrl)
  )
  for (const paneId of PLACEHOLDER_PANE_IDS) {
    registerPaneRenderer(paneId, () => new HelloWorldPane(paneId))
  }

  const catalog = appCfg.layoutCatalog

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
