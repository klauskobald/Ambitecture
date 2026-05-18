import { resolveDescriptorsForClass } from '../../core/systemCapabilities.js'
import { projectGraph } from '../../core/projectGraph.js'
import { IntentParamsSelect } from '../components/intentParamsSelect.js'
import { cloneParamSlice } from './actionEditUtil.js'

/**
 * @typedef {object} IntentActionParamsState
 * @property {string} intentActionGuidForParams
 * @property {string} intentExecuteGuidForParams
 * @property {boolean} hasIntentDescriptors
 * @property {unknown[]} descriptors
 * @property {Record<string, unknown>} paramsSnapshot
 * @property {Record<string, Record<string, unknown>>} draftBySlot
 */

/** @type {Array<{ destroy: () => void }>} */
let ipsBuilt = []

export function destroyIntentParamWidgets () {
  for (const x of ipsBuilt) x.destroy()
  ipsBuilt = []
}

/**
 * @param {string} intentExecuteGuid
 * @returns {{ descriptors: unknown[], hasIntentDescriptors: boolean }}
 */
export function resolveIntentDescriptorsForExecute (intentExecuteGuid) {
  if (!intentExecuteGuid) {
    return { descriptors: [], hasIntentDescriptors: false }
  }
  const intent = projectGraph.getEffectiveIntent(intentExecuteGuid)
  const rec =
    intent && typeof intent === 'object' && !Array.isArray(intent)
      ? /** @type {Record<string, unknown>} */ (intent)
      : null
  const cls = typeof rec?.class === 'string' && rec.class.length > 0 ? rec.class : null
  const descriptorsRaw = cls ? resolveDescriptorsForClass(cls) : null
  const descriptors = Array.isArray(descriptorsRaw) ? descriptorsRaw : []
  return { descriptors, hasIntentDescriptors: descriptors.length > 0 }
}

/**
 * @param {IntentActionParamsState} state
 * @param {string} typeClass
 * @param {Array<{ class: string, params?: Record<string, string> }>} inputTypes
 */
export function rebuildIntentDraftFromSnapshot (state, typeClass, inputTypes) {
  const def = inputTypes.find(t => t.class === typeClass)
  state.draftBySlot = {}
  if (!def?.params) return
  for (const pk of Object.keys(def.params)) {
    state.draftBySlot[pk] = cloneParamSlice(state.paramsSnapshot?.[pk])
  }
}

/**
 * Input-edit host: intent params sliced by perform input type slots.
 * @param {HTMLElement} paramHost
 * @param {IntentActionParamsState} state
 * @param {object} opts
 * @param {string} opts.idPrefix
 * @param {number} opts.actionIndex
 * @param {string} opts.typeClass
 * @param {Array<{ class: string, params?: Record<string, string> }>} opts.inputTypes
 */
export function renderIntentActionParamsWithInputSlots (
  paramHost,
  state,
  opts
) {
  destroyIntentParamWidgets()
  paramHost.replaceChildren()

  const def = opts.inputTypes.find(t => t.class === opts.typeClass)
  if (!def?.params) return

  const needsJsonSlots = Object.values(def.params).some(k => k === 'jsonString')
  if (needsJsonSlots && !state.hasIntentDescriptors) return

  for (const [paramKey, kind] of Object.entries(def.params)) {
    if (kind !== 'jsonString') continue

    const lab = document.createElement('label')
    lab.className = 'input-assign-modal__label'
    lab.textContent = paramKey

    if (!state.draftBySlot[paramKey]) {
      state.draftBySlot[paramKey] = {}
    }
    const paramsSlice = state.draftBySlot[paramKey]

    const ips = new IntentParamsSelect(true)
    const built = ips.build({
      id: `${opts.idPrefix}-${paramKey}-${opts.actionIndex}`,
      params: paramsSlice,
      descriptors: state.descriptors,
      onLifecycle: () => {}
    })
    ipsBuilt.push(built)

    const holder = document.createElement('div')
    holder.className = 'intent-params-select__wrap'
    holder.appendChild(built.root)
    lab.appendChild(holder)
    paramHost.appendChild(lab)
  }
}

/**
 * Generic host (pulse, etc.): full execute.params via one IntentParamsSelect.
 * @param {HTMLElement} paramHost
 * @param {IntentActionParamsState} state
 * @param {object} opts
 * @param {string} opts.idPrefix
 * @param {number} opts.actionIndex
 */
export function renderIntentActionParamsDirect (paramHost, state, opts) {
  destroyIntentParamWidgets()
  paramHost.replaceChildren()
  if (!state.hasIntentDescriptors) return

  if (!state.draftBySlot._full) {
    state.draftBySlot._full = cloneParamSlice(state.paramsSnapshot)
  }
  const paramsSlice = state.draftBySlot._full

  const ips = new IntentParamsSelect(true)
  const built = ips.build({
    id: `${opts.idPrefix}-full-${opts.actionIndex}`,
    params: paramsSlice,
    descriptors: state.descriptors,
    onLifecycle: () => {}
  })
  ipsBuilt.push(built)

  const holder = document.createElement('div')
  holder.className = 'intent-params-select__wrap'
  holder.appendChild(built.root)
  paramHost.appendChild(holder)
}

/**
 * @param {IntentActionParamsState} state
 * @param {string} typeClass
 * @param {Array<{ class: string, params?: Record<string, string> }>} inputTypes
 * @returns {boolean}
 */
export function canEmitIntentActionPatchWithInputSlots (
  state,
  typeClass,
  inputTypes
) {
  const def = inputTypes.find(t => t.class === typeClass)
  const needsJsonSlots =
    !!def?.params &&
    Object.values(def.params).some(k => k === 'jsonString')
  return (
    state.hasIntentDescriptors &&
    needsJsonSlots &&
    state.intentActionGuidForParams.length > 0 &&
    state.intentExecuteGuidForParams.length > 0
  )
}

/**
 * @param {IntentActionParamsState} state
 * @param {string} typeClass
 * @param {Array<{ class: string, params?: Record<string, string> }>} inputTypes
 * @returns {{ type: 'intent', guid: string, params: Record<string, unknown> } | null}
 */
export function buildIntentExecutePatchWithInputSlots (
  state,
  typeClass,
  inputTypes
) {
  if (!canEmitIntentActionPatchWithInputSlots(state, typeClass, inputTypes)) {
    return null
  }
  const def = inputTypes.find(t => t.class === typeClass)
  if (!def?.params) return null
  const nextParams = {}
  for (const [paramKey, kind] of Object.entries(def.params)) {
    if (kind !== 'jsonString') continue
    const slice = state.draftBySlot[paramKey]
    if (slice && typeof slice === 'object') {
      nextParams[paramKey] = slice
    }
  }
  return {
    type: 'intent',
    guid: state.intentExecuteGuidForParams,
    params: nextParams
  }
}

/**
 * @param {IntentActionParamsState} state
 * @returns {{ type: 'intent', guid: string, params: Record<string, unknown> } | null}
 */
export function buildIntentExecutePatchDirect (state) {
  if (
    !state.hasIntentDescriptors ||
    state.intentActionGuidForParams.length === 0 ||
    state.intentExecuteGuidForParams.length === 0
  ) {
    return null
  }
  const full = state.draftBySlot._full
  if (!full || typeof full !== 'object') return null
  return {
    type: 'intent',
    guid: state.intentExecuteGuidForParams,
    params: full
  }
}
