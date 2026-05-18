import { performPolicy, editPolicy } from '../viewport/interactionPolicies.js'
import { getStageOverlay } from './stageOverlayHost.js'

/** @type {'perform' | 'edit'} */
let mode = 'perform'

/** @type {((guid: string) => void) | null} */
let doubleTapIntentHandler = null

/** @type {((detail: { clientX: number, clientY: number }) => void) | null} */
let doubleTapEmptyHandler = null

function applyOverlayPolicy () {
  const overlay = getStageOverlay()
  if (!overlay) return
  overlay.setPolicy(mode === 'edit' ? editPolicy : performPolicy)
  if (mode === 'edit') {
    overlay.setDoubleTapIntentCallback(doubleTapIntentHandler)
    overlay.setDoubleTapEmptyCallback(doubleTapEmptyHandler)
  } else {
    overlay.setDoubleTapIntentCallback(null)
    overlay.setDoubleTapEmptyCallback(null)
  }
}

export function setPerformMode () {
  mode = 'perform'
  applyOverlayPolicy()
}

export function setEditMode () {
  mode = 'edit'
  applyOverlayPolicy()
}

/** @returns {'perform' | 'edit'} */
export function getStageMode () {
  return mode
}

/**
 * @param {(guid: string) => void} onIntent
 * @param {(detail: { clientX: number, clientY: number }) => void} [onEmpty]
 */
export function setEditDoubleTapHandlers (onIntent, onEmpty) {
  doubleTapIntentHandler = onIntent
  doubleTapEmptyHandler = onEmpty ?? null
  if (mode === 'edit') applyOverlayPolicy()
}

export function clearEditDoubleTapHandlers () {
  doubleTapIntentHandler = null
  doubleTapEmptyHandler = null
  if (mode === 'edit') applyOverlayPolicy()
}

export function refreshOverlayPolicy () {
  applyOverlayPolicy()
}
