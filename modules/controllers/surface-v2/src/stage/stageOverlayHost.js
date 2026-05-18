/** @type {import('../viewport/overlayCanvas.js').OverlayCanvas | null} */
let stageOverlay = null

/** @param {import('../viewport/overlayCanvas.js').OverlayCanvas | null} overlay */
export function setStageOverlay (overlay) {
  stageOverlay = overlay
}

/** @returns {import('../viewport/overlayCanvas.js').OverlayCanvas | null} */
export function getStageOverlay () {
  return stageOverlay
}

export function markStageOverlayActivity () {
  stageOverlay?.markRenderActivity()
}
