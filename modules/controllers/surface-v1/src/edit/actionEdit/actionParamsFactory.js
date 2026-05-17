import { projectGraph } from '../../core/projectGraph.js'
import {
  resolveAnimationCommandsForClass,
  resolveDescriptorsForClass
} from '../../core/systemCapabilities.js'
import { recordOrUndefined } from './actionEditUtil.js'
import { renderSceneActionParams } from './sceneActionParams.js'
import {
  destroyIntentParamWidgets,
  renderIntentActionParamsDirect,
  renderIntentActionParamsWithInputSlots
} from './intentActionParams.js'
import { renderAnimationActionParams } from './animationActionParams.js'

/**
 * @typedef {object} ActionSelectionState
 * @property {number} actionIndex
 * @property {string} intentActionGuidForParams
 * @property {string} intentExecuteGuidForParams
 * @property {boolean} hasIntentDescriptors
 * @property {unknown[]} descriptors
 * @property {Record<string, unknown>} paramsSnapshot
 * @property {Record<string, Record<string, unknown>>} draftBySlot
 * @property {string} animationActionGuidForParams
 * @property {string} animationGuidForParams
 * @property {boolean} hasAnimationCommands
 * @property {{ command: string, hint: string, params: Record<string, unknown> }[] | null} animationCommands
 * @property {{ command?: string, [key: string]: unknown }} animationParamsDraft
 * @property {string} activeExecuteType
 */

/**
 * @returns {ActionSelectionState}
 */
export function createEmptyActionSelectionState () {
  return {
    actionIndex: 0,
    intentActionGuidForParams: '',
    intentExecuteGuidForParams: '',
    hasIntentDescriptors: false,
    descriptors: [],
    paramsSnapshot: {},
    draftBySlot: {},
    animationActionGuidForParams: '',
    animationGuidForParams: '',
    hasAnimationCommands: false,
    animationCommands: null,
    animationParamsDraft: {},
    activeExecuteType: ''
  }
}

/**
 * @param {ActionSelectionState} state
 */
function recomputeAnimationCommandsForState (state) {
  const g = state.animationGuidForParams
  if (!g) {
    state.animationCommands = null
    state.hasAnimationCommands = false
    return
  }
  const anim = projectGraph.getAnimations().get(g)
  const rec =
    anim && typeof anim === 'object' && !Array.isArray(anim)
      ? /** @type {Record<string, unknown>} */ (anim)
      : null
  const runmode = typeof rec?.runmode === 'string' ? rec.runmode : 'auto'
  if (runmode !== 'manual') {
    state.animationCommands = null
    state.hasAnimationCommands = false
    return
  }
  const cls = typeof rec?.class === 'string' && rec.class.length > 0 ? rec.class : null
  const cmds = cls ? resolveAnimationCommandsForClass(cls) : null
  state.animationCommands = cmds
  state.hasAnimationCommands = Array.isArray(cmds) && cmds.length > 0
}

/**
 * @param {ActionSelectionState} state
 */
function recomputeIntentDescriptorsForState (state) {
  const g = state.intentExecuteGuidForParams
  if (!g) {
    state.descriptors = []
    state.hasIntentDescriptors = false
    return
  }
  const intent = projectGraph.getEffectiveIntent(g)
  const rec =
    intent && typeof intent === 'object' && !Array.isArray(intent)
      ? /** @type {Record<string, unknown>} */ (intent)
      : null
  const cls = typeof rec?.class === 'string' && rec.class.length > 0 ? rec.class : null
  const descriptorsRaw = cls ? resolveDescriptorsForClass(cls) : null
  state.descriptors = Array.isArray(descriptorsRaw) ? descriptorsRaw : []
  state.hasIntentDescriptors = state.descriptors.length > 0
}

/**
 * @param {ActionSelectionState} state
 * @param {string[]} actionGuidsList
 */
export function applyActionSelection (state, actionGuidsList) {
  const n = actionGuidsList.length
  if (n === 0) {
    state.intentActionGuidForParams = ''
    state.intentExecuteGuidForParams = ''
    state.animationActionGuidForParams = ''
    state.animationGuidForParams = ''
    state.paramsSnapshot = {}
    state.animationParamsDraft = {}
    state.activeExecuteType = ''
    recomputeIntentDescriptorsForState(state)
    recomputeAnimationCommandsForState(state)
    return
  }
  state.actionIndex = Math.max(0, Math.min(n - 1, state.actionIndex))
  const ag = actionGuidsList[state.actionIndex]
  state.intentActionGuidForParams = ''
  state.intentExecuteGuidForParams = ''
  state.animationActionGuidForParams = ''
  state.animationGuidForParams = ''
  state.activeExecuteType = ''
  if (ag) {
    const a = projectGraph.getActions().get(ag)
    const ex = a?.execute
    if (
      ex &&
      typeof ex === 'object' &&
      !Array.isArray(ex) &&
      typeof ex.guid === 'string'
    ) {
      const exType = typeof ex.type === 'string' ? ex.type : ''
      state.activeExecuteType = exType
      if (exType === 'intent') {
        state.intentActionGuidForParams = ag
        state.intentExecuteGuidForParams = ex.guid
      } else if (exType === 'animation') {
        state.animationActionGuidForParams = ag
        state.animationGuidForParams = ex.guid
      }
    }
  }
  const activeActionGuid =
    state.intentActionGuidForParams || state.animationActionGuidForParams
  const rawStoredParams =
    activeActionGuid.length > 0
      ? (() => {
          const a = projectGraph.getActions().get(activeActionGuid)
          const x = a?.execute
          return x && typeof x === 'object' && !Array.isArray(x) ? x.params : undefined
        })()
      : undefined
  state.paramsSnapshot = recordOrUndefined(rawStoredParams) ?? {}
  state.animationParamsDraft =
    state.animationActionGuidForParams.length > 0
      ? { ...state.paramsSnapshot }
      : {}
  recomputeIntentDescriptorsForState(state)
  recomputeAnimationCommandsForState(state)
}

/**
 * @param {HTMLElement} paramHost
 * @param {ActionSelectionState} state
 * @param {object} renderOpts
 * @param {string} renderOpts.idPrefix
 * @param {string} renderOpts.typeClass
 * @param {Array<{ class: string, params?: Record<string, string> }>} renderOpts.inputTypes
 * @param {{ getInputTypeClass: () => string } | null} renderOpts.intentParamBinding
 */
export function renderActionParams (paramHost, state, renderOpts) {
  destroyIntentParamWidgets()
  paramHost.replaceChildren()

  switch (state.activeExecuteType) {
    case 'animation':
      if (
        state.animationActionGuidForParams.length > 0 &&
        state.hasAnimationCommands &&
        state.animationCommands
      ) {
        renderAnimationActionParams(paramHost, state)
      }
      return
    case 'intent':
      if (renderOpts.intentParamBinding) {
        renderIntentActionParamsWithInputSlots(paramHost, state, {
          idPrefix: renderOpts.idPrefix,
          actionIndex: state.actionIndex,
          typeClass: renderOpts.typeClass,
          inputTypes: renderOpts.inputTypes
        })
      } else {
        renderIntentActionParamsDirect(paramHost, state, {
          idPrefix: renderOpts.idPrefix,
          actionIndex: state.actionIndex
        })
      }
      return
    case 'scene':
      renderSceneActionParams(paramHost)
      return
    default:
      return
  }
}
