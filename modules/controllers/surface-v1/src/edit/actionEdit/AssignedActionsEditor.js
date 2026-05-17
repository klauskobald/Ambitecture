import { projectGraph } from '../../core/projectGraph.js'
import { sendActionInputCommand } from '../../core/outboundQueue.js'
import { executeTargetSummary } from './executeTargetSummary.js'
import {
  applyActionSelection,
  createEmptyActionSelectionState,
  renderActionParams
} from './actionParamsFactory.js'
import { destroyIntentParamWidgets } from './intentActionParams.js'
import {
  buildAnimationExecutePatch,
  canEmitAnimationActionPatch
} from './animationActionParams.js'
import {
  buildIntentExecutePatchDirect,
  buildIntentExecutePatchWithInputSlots,
  rebuildIntentDraftFromSnapshot
} from './intentActionParams.js'
import { cloneParamSlice } from './actionEditUtil.js'

export class AssignedActionsEditor {
  /**
   * @param {object} opts
   * @param {string[]} opts.actionGuids
   * @param {string} opts.idPrefix
   * @param {Array<{ class: string, params?: Record<string, string> }>} opts.inputTypes
   * @param {{ getInputTypeClass: () => string } | null} [opts.intentParamBinding]
   * @returns {{ root: HTMLElement, destroy: () => void, setInputTypeClass: (typeClass: string) => void, emitActionPatches: () => void }}
   */
  build (opts) {
    const actionGuidsList = [...opts.actionGuids]
    const inputTypes = opts.inputTypes
    const intentParamBinding = opts.intentParamBinding ?? null
    const state = createEmptyActionSelectionState()

    const root = document.createElement('div')
    root.className = 'assigned-actions-editor'

    const assignedTitle = document.createElement('p')
    assignedTitle.className = 'modal-text'
    assignedTitle.textContent = 'Assigned actions'

    const actionNav = document.createElement('div')
    actionNav.className = 'input-assign-modal__action-nav'
    const prevBtn = document.createElement('button')
    prevBtn.type = 'button'
    prevBtn.className = 'btn'
    prevBtn.textContent = 'Prev'
    const summaryEl = document.createElement('p')
    summaryEl.className = 'modal-text input-assign-modal__action-summary'
    summaryEl.textContent = '—'
    const nextBtn = document.createElement('button')
    nextBtn.type = 'button'
    nextBtn.className = 'btn'
    nextBtn.textContent = 'Next'
    const counterEl = document.createElement('span')
    counterEl.className = 'input-assign-modal__action-counter'
    actionNav.appendChild(prevBtn)
    actionNav.appendChild(summaryEl)
    actionNav.appendChild(nextBtn)
    actionNav.appendChild(counterEl)

    const paramHost = document.createElement('div')
    paramHost.className = 'input-assign-modal__param-host'

    root.appendChild(assignedTitle)
    root.appendChild(actionNav)
    root.appendChild(paramHost)

    const syncActionStepper = () => {
      const n = actionGuidsList.length
      if (n === 0) {
        summaryEl.textContent = 'No actions assigned'
        counterEl.textContent = ''
        prevBtn.disabled = true
        nextBtn.disabled = true
        return
      }
      state.actionIndex = Math.max(0, Math.min(n - 1, state.actionIndex))
      const ag = actionGuidsList[state.actionIndex]
      const act = ag ? projectGraph.getActions().get(ag) : undefined
      const ex =
        act && typeof act.execute === 'object' && !Array.isArray(act.execute)
          ? /** @type {Record<string, unknown>} */ (act.execute)
          : undefined
      summaryEl.textContent = executeTargetSummary(ex)
      counterEl.textContent = `${state.actionIndex + 1} / ${n}`
      prevBtn.disabled = n <= 1 || state.actionIndex === 0
      nextBtn.disabled = n <= 1 || state.actionIndex >= n - 1
    }

    const getTypeClass = () =>
      intentParamBinding ? intentParamBinding.getInputTypeClass() : ''

    const rebuildDraftFromSnapshot = typeClass => {
      if (state.animationActionGuidForParams.length > 0) {
        state.animationParamsDraft = { ...state.paramsSnapshot }
        return
      }
      if (intentParamBinding) {
        rebuildIntentDraftFromSnapshot(state, typeClass, inputTypes)
      } else if (state.intentActionGuidForParams.length > 0) {
        state.draftBySlot = { _full: cloneParamSlice(state.paramsSnapshot) }
      }
    }

    const renderParams = () => {
      renderActionParams(paramHost, state, {
        idPrefix: opts.idPrefix,
        typeClass: getTypeClass(),
        inputTypes,
        intentParamBinding
      })
    }

    const refreshSelection = () => {
      applyActionSelection(state, actionGuidsList)
      rebuildDraftFromSnapshot(getTypeClass())
      syncActionStepper()
      renderParams()
    }

    prevBtn.addEventListener('click', () => {
      if (actionGuidsList.length <= 1) return
      state.actionIndex = Math.max(0, state.actionIndex - 1)
      refreshSelection()
    })
    nextBtn.addEventListener('click', () => {
      if (actionGuidsList.length <= 1) return
      state.actionIndex = Math.min(actionGuidsList.length - 1, state.actionIndex + 1)
      refreshSelection()
    })

    refreshSelection()

    return {
      root,
      destroy: () => {
        destroyIntentParamWidgets()
      },
      setInputTypeClass: typeClass => {
        rebuildDraftFromSnapshot(typeClass)
        renderParams()
      },
      emitActionPatches: () => {
        const typeClass = getTypeClass()
        if (intentParamBinding) {
          const intentPatch = buildIntentExecutePatchWithInputSlots(
            state,
            typeClass,
            inputTypes
          )
          if (intentPatch) {
            sendActionInputCommand({
              command: 'updateAction',
              actionGuid: state.intentActionGuidForParams,
              patch: { execute: intentPatch }
            })
          }
        } else {
          const intentPatch = buildIntentExecutePatchDirect(state)
          if (intentPatch) {
            sendActionInputCommand({
              command: 'updateAction',
              actionGuid: state.intentActionGuidForParams,
              patch: { execute: intentPatch }
            })
          }
        }

        if (canEmitAnimationActionPatch(state)) {
          const animPatch = buildAnimationExecutePatch(state)
          if (animPatch) {
            sendActionInputCommand({
              command: 'updateAction',
              actionGuid: state.animationActionGuidForParams,
              patch: { execute: animPatch }
            })
          }
        }
      }
    }
  }
}
