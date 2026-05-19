import { selectionState } from './selectionState.js'
import { projectGraph } from '../core/projectGraph.js'
import {
  sendGraphCommand,
  sendSaveProject,
  sendSceneActivate
} from '../core/outboundQueue.js'
import { warn as modalWarn, pickChoice } from '../core/Modal.js'

/**
 * @returns {Promise<boolean>} true if at least one intent was copied
 */
export async function runCopySelectedIntents () {
  const activeScene = projectGraph.getActiveSceneName()
  if (!activeScene) {
    void modalWarn('Select or create a scene first.')
    return false
  }
  const sourceGuids = [...selectionState.getGuids()]
  if (sourceGuids.length === 0) return false

  const cryptoApi = globalThis.crypto
  /** @type {Array<{ srcGuid: string, newGuid: string, value: Record<string, unknown> }>} */
  const created = []
  let i = 0
  for (const srcGuid of sourceGuids) {
    const effective = projectGraph.getEffectiveIntent(srcGuid)
    if (!effective) continue
    /** @type {Record<string, unknown>} */
    const raw = JSON.parse(JSON.stringify(effective))
    delete raw.scheduled
    const cls = String(raw.class ?? 'light')
    const suffix =
      cryptoApi?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const newGuid = `${cls}-${suffix}`
    raw.guid = newGuid
    const pos = /** @type {unknown} */ (raw.position)
    if (Array.isArray(pos) && pos.length >= 3) {
      const step = 0.25 * (i + 1)
      raw.position = [
        Number(pos[0]) + step,
        Number(pos[1]),
        Number(pos[2]) + step
      ]
    }
    i += 1

    projectGraph.putIntentRecord(raw)
    projectGraph.appendControllerIntentRef(newGuid)
    projectGraph.addIntentRefToSceneIfMissing(activeScene, newGuid)
    created.push({ srcGuid, newGuid, value: raw })
  }

  if (created.length === 0) {
    void modalWarn('Nothing to copy.')
    return false
  }

  for (const { value, newGuid } of created) {
    sendGraphCommand({
      op: 'upsert',
      entityType: 'intent',
      guid: newGuid,
      value,
      persistence: 'runtimeAndDurable'
    })
  }

  const controllerGuid = projectGraph.getControllerGuid()
  if (controllerGuid) {
    /** @type {Record<string, unknown>} */
    const patch = { intents: projectGraph.getControllerIntentRefs() }
    for (const { srcGuid, newGuid } of created) {
      const enabled = !!projectGraph.getIntentConfig(srcGuid).performEnabled
      projectGraph.setIntentConfig(newGuid, 'performEnabled', enabled)
      projectGraph.patchControllerState(
        `interactionPolicies.performEnabled.${newGuid}`,
        enabled
      )
      patch[`interactionPolicies.performEnabled.${newGuid}`] = enabled
      const qpKeys = projectGraph.getQuickPanelDotKeys(srcGuid)
      if (qpKeys.length > 0) {
        projectGraph.patchControllerState(
          `interactionPolicies.quickPanel.${newGuid}`,
          qpKeys
        )
        patch[`interactionPolicies.quickPanel.${newGuid}`] = qpKeys
      }
    }
    sendGraphCommand({
      op: 'patch',
      entityType: 'controller',
      guid: controllerGuid,
      patch,
      persistence: 'runtimeAndDurable'
    })
  }

  sendSaveProject('scenes', projectGraph.getScenesData())
  if (activeScene === projectGraph.getActiveSceneName()) {
    const sceneGuid = projectGraph.getSceneGuid(activeScene)
    if (sceneGuid) sendSceneActivate(sceneGuid)
  }

  return true
}

/**
 * @returns {Promise<boolean>} true if something was deleted or removed from scene
 */
export async function runDeleteSelectedIntents () {
  const guids = [...selectionState.getGuids()]
  if (guids.length === 0) return false

  const choice = await pickChoice('Delete selected intent(s)', [
    { value: 'purge', label: 'Delete completely' },
    { value: 'scene', label: 'Remove from Scene' }
  ])
  if (!choice) return false

  if (choice === 'scene') {
    const activeScene = projectGraph.getActiveSceneName()
    if (!activeScene) {
      void modalWarn('Select or create a scene first.')
      return false
    }
    let changed = false
    for (const guid of guids) {
      if (projectGraph.removeIntentRefFromScene(activeScene, guid)) changed = true
    }
    if (!changed) {
      void modalWarn('Selected intent(s) are not in the active scene.')
      return false
    }
    sendSaveProject('scenes', projectGraph.getScenesData())
    if (activeScene === projectGraph.getActiveSceneName()) {
      const sceneGuid = projectGraph.getSceneGuid(activeScene)
      if (sceneGuid) sendSceneActivate(sceneGuid)
    }
    return true
  }

  if (choice === 'purge') {
    const toPurge = guids.filter(g => projectGraph.getIntents().has(g))
    if (toPurge.length === 0) {
      void modalWarn('Nothing to delete.')
      return false
    }
    /** @type {string[]} */
    const performRemoveKeys = []
    for (const guid of toPurge) {
      performRemoveKeys.push(`interactionPolicies.performEnabled.${guid}`)
      performRemoveKeys.push(`interactionPolicies.quickPanel.${guid}`)
      projectGraph.purgeIntentFromProject(guid)
    }
    sendSaveProject('scenes', projectGraph.getScenesData())
    for (const guid of toPurge) {
      sendGraphCommand({
        op: 'remove',
        entityType: 'intent',
        guid,
        persistence: 'runtimeAndDurable'
      })
    }
    const controllerGuid = projectGraph.getControllerGuid()
    if (controllerGuid) {
      sendGraphCommand({
        op: 'patch',
        entityType: 'controller',
        guid: controllerGuid,
        patch: { intents: projectGraph.getControllerIntentRefs() },
        remove: performRemoveKeys,
        persistence: 'runtimeAndDurable'
      })
    }
    const activeScene = projectGraph.getActiveSceneName()
    if (activeScene) {
      const sceneGuid = projectGraph.getSceneGuid(activeScene)
      if (sceneGuid) sendSceneActivate(sceneGuid)
    }
    return true
  }

  return false
}
