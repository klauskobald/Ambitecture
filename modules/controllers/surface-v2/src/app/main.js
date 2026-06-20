import { loadAppConfig, applyLayoutCssVars } from './config.js'
import { connectStageHub } from './hubConnection.js'
import { keyboardManager } from '../core/KeyboardManager.js'
import { LayoutManager } from '../layout/LayoutManager.js'
import { registerPaneRenderer } from '../layout/paneRendererRegistry.js'
import { initStageCommon } from '../stage/stageCommon.js'
import { Simulator2dPane } from '../layout/renderers/Simulator2dPane.js'
import { StagePane } from '../layout/renderers/StagePane.js'
import {
  StageEditPane,
  rebindIntentParamsHost,
  rebindFixtureParamsHost
} from '../layout/renderers/StageEditPane.js'
import { ScenesPane } from '../layout/renderers/ScenesPane.js'
import { ControlPane } from '../layout/renderers/ControlPane.js'
import { PulsePane } from '../layout/renderers/PulsePane.js'
import { AnimationPane } from '../layout/renderers/AnimationPane.js'
import { SnapshotPane } from '../layout/renderers/SnapshotPane.js'
import { PluginPane } from '../layout/renderers/PluginPane.js'
import { initSceneAutoResetOnLoad } from '../perform/sceneAutoResetOnLoad.js'
import { HelpManager } from '../core/help/HelpManager.js'
import { findLayoutTagHost } from '../stage/layoutTagHost.js'

async function main () {
  const appCfg = await loadAppConfig()
  if (!appCfg) return

  applyLayoutCssVars(appCfg.layout)
  initStageCommon(appCfg.simulatorIframeUrl, appCfg.layout)

  registerPaneRenderer(
    'simulator-2d',
    Simulator2dPane,
    () => new Simulator2dPane(appCfg.simulatorIframeUrl)
  )
  registerPaneRenderer('stage', StagePane)
  registerPaneRenderer('stage-edit', StageEditPane)
  registerPaneRenderer('scenes', ScenesPane)
  registerPaneRenderer('control', ControlPane)
  registerPaneRenderer('pulse', PulsePane)
  registerPaneRenderer('animation', AnimationPane)
  registerPaneRenderer('snapshot', SnapshotPane)
  registerPaneRenderer(
    'plugin',
    PluginPane,
    args => new PluginPane(args[0] ?? '')
  )

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
    defaultLayoutId: '2cols',
    onLayoutRebuild: () => {
      rebindIntentParamsHost()
      rebindFixtureParamsHost()
    }
  })

  HelpManager.registerHost('edit-panel', () => findLayoutTagHost())

  initSceneAutoResetOnLoad()
  connectStageHub(appCfg)
  keyboardManager.start()

  window.LayoutManager = LayoutManager
  window.HelpManager = HelpManager
}

main()
