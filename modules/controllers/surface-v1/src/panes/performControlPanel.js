/**
 * Perform → Control subpane: host for scene / perform button inputs (`.perform-controls`).
 */

/**
 * @returns {{ panel: HTMLDivElement, controlsMount: HTMLDivElement }}
 */
export function createPerformControlPanel () {
  const panel = document.createElement('div')
  panel.className = 'perform-subpane perform-subpane--control'

  const controlsMount = document.createElement('div')
  controlsMount.className = 'perform-controls'
  panel.appendChild(controlsMount)

  return { panel, controlsMount }
}
