import { loadAppConfig, applyLayoutCssVars } from './config.js'
import { connectStageHub } from './hubConnection.js'
import { LayoutManager } from '../layout/LayoutManager.js'
import { registerPaneRenderer } from '../layout/paneRendererRegistry.js'
import { registerLeafChrome } from '../layout/leafChromeRegistry.js'
import { stageEditLeafChrome } from '../layout/renderers/StageEditPane.js'
import { HelloWorldPane } from '../layout/renderers/HelloWorldPane.js'
import { Simulator2dPane } from '../layout/renderers/Simulator2dPane.js'
import { StagePane } from '../layout/renderers/StagePane.js'
import { StageEditPane } from '../layout/renderers/StageEditPane.js'

/** @type {string[]} */
const PLACEHOLDER_PANE_IDS = ['control', 'pulse', 'animation', 'plugins']

async function main () {
  const appCfg = await loadAppConfig()
  if (!appCfg) return

  applyLayoutCssVars(appCfg.layout)

  registerPaneRenderer(
    'simulator-2d',
    () => new Simulator2dPane(appCfg.simulatorIframeUrl)
  )
  registerPaneRenderer(
    'stage',
    () => new StagePane(appCfg.simulatorIframeUrl, appCfg.layout)
  )
  registerLeafChrome(stageEditLeafChrome)
  registerPaneRenderer('stage-edit', () => new StageEditPane())
  for (const paneId of PLACEHOLDER_PANE_IDS) {
    registerPaneRenderer(paneId, () => new HelloWorldPane(paneId))
  }

  const toolbar = document.getElementById('layout-toolbar')
  const stage = document.getElementById('layout-stage')
  if (!toolbar || !stage) {
    console.error('Missing #layout-toolbar or #layout-stage')
    return
  }

  LayoutManager.init({
    toolbar,
    stage,
    catalog: appCfg.layoutCatalog,
    defaultLayoutId: '2cols'
  })

  connectStageHub(appCfg)

  window.LayoutManager = LayoutManager
}

main()
