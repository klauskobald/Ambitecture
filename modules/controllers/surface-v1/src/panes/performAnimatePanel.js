/**
 * Perform → Animate subpane: placeholder for timeline / animation UI.
 */

/**
 * @returns {{ panel: HTMLDivElement }}
 */
export function createPerformAnimatePanel () {
  const panel = document.createElement('div')
  panel.className = 'perform-subpane perform-subpane--animate'
  panel.hidden = true

  return { panel }
}
