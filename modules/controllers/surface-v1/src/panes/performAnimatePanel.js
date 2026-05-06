/**
 * Perform → Animate subpane: list project animations with play / stop (hub `action:trigger` + `args.command`).
 */

import { projectGraph } from '../core/projectGraph.js'
import { sendActionTrigger } from '../core/outboundQueue.js'
import {
  isAnimationPlaying,
  subscribeAnimationPlayState
} from '../core/animationPlayRegistry.js'
import { getAnimatorViewer } from './animators/animatorViewerRegistry.js'

/**
 * @returns {{ panel: HTMLDivElement }}
 */
export function createPerformAnimatePanel () {
  const panel = document.createElement('div')
  panel.className = 'perform-subpane perform-subpane--animate'
  panel.hidden = true

  const list = document.createElement('div')
  list.className = 'perform-animate-list'
  list.setAttribute('role', 'list')

  panel.appendChild(list)

  function render () {
    const anims = projectGraph.getPlayableAnimationsList()
    list.replaceChildren()
    if (anims.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'perform-animate-empty'
      empty.textContent = 'No animations in project.'
      list.appendChild(empty)
      return
    }
    for (const row of anims) {
      list.appendChild(makeRow(row))
    }
  }

  /**
   * @param {{ guid: string, name: string, class: string, targetIntent: string }} row
   */
  function makeRow (row) {
    const el = document.createElement('div')
    el.className = 'perform-animate-row'
    el.setAttribute('role', 'listitem')
    el.dataset.animationGuid = row.guid

    const label = document.createElement('div')
    label.className = 'perform-animate-row__label'

    const title = document.createElement('span')
    title.className = 'perform-animate-row__name'
    title.textContent = row.name

    label.appendChild(title)
    if (row.class) {
      const hint = document.createElement('span')
      hint.className = 'perform-animate-row__class'
      const viewer = getAnimatorViewer(row.class)
      hint.textContent = ` (${viewer ? viewer.getName() : row.class})`
      label.appendChild(hint)
    }

    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'perform-animate-toggle'

    function syncToggle () {
      const playing = isAnimationPlaying(row.guid)
      toggle.classList.toggle('perform-animate-toggle--stop', playing)
      toggle.classList.toggle('perform-animate-toggle--play', !playing)
      toggle.setAttribute(
        'aria-label',
        playing ? `Stop animation ${row.name}` : `Play animation ${row.name}`
      )
      toggle.setAttribute('aria-pressed', playing ? 'true' : 'false')
      toggle.textContent = playing ? '■' : '▶'
    }

    syncToggle()
    toggle.addEventListener('click', () => {
      if (isAnimationPlaying(row.guid)) {
        sendActionTrigger(row.guid, { command: 'stop' })
      } else {
        sendActionTrigger(row.guid, { command: 'start' })
      }
    })

    el.appendChild(label)
    el.appendChild(toggle)
    return el
  }

  projectGraph.subscribe(render)
  subscribeAnimationPlayState(render)
  render()

  return { panel }
}
