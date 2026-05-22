import { projectGraph } from '../core/projectGraph.js'
import { sendSceneActivate } from '../core/outboundQueue.js'
import { isSceneAutoResetOnLoadEnabled } from './sceneAutoResetPreference.js'

export function maybeClearRuntimeOverlayForActiveScene () {
  if (!isSceneAutoResetOnLoadEnabled()) return
  const guids = projectGraph.getRuntimeOverlayGuidsInScene()
  if (guids.length === 0) return
  const name = projectGraph.getActiveSceneName()
  if (typeof name !== 'string' || name.length === 0) return
  const guid = projectGraph.getSceneGuid(name)
  if (!guid) return
  sendSceneActivate(guid, { runtimeMergeClear: 'scene' })
}

/**
 * Hub `action:trigger` scene switches omit merge clear; follow up when auto-reset is on.
 */
export function initSceneAutoResetOnLoad () {
  projectGraph.subscribe(['scenes', 'runtimeOverlayHints'], () => {
    maybeClearRuntimeOverlayForActiveScene()
  })
}
