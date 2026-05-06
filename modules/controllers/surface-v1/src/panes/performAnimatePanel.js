/**
 * Perform → Animate subpane: list project animations with play / stop (hub `action:trigger` + `args.command`).
 */

import { projectGraph } from '../core/projectGraph.js'
import { sendActionTrigger } from '../core/outboundQueue.js'
import {
  isAnimationPlaying,
  getAnimationStatusMessage,
  subscribeAnimationPlayState
} from '../core/animationPlayRegistry.js'
import { getAnimatorViewer } from './animators/animatorViewerRegistry.js'
import { createAnimationEditPane } from './performAnimateEditPane.js'

/**
 * @returns {{ panel: HTMLDivElement }}
 */
export function createPerformAnimatePanel () {
  const panel = document.createElement('div')
  panel.className = 'perform-subpane perform-subpane--animate'
  panel.hidden = true

  // ── list view ────────────────────────────────────────────────────────────

  const listView = document.createElement('div')
  listView.className = 'perform-animate-list-view'

  const list = document.createElement('div')
  list.className = 'perform-animate-list'
  list.setAttribute('role', 'list')

  listView.appendChild(list)
  panel.appendChild(listView)

  // ── edit pane ─────────────────────────────────────────────────────────────

  const { el: editPaneEl, open: openEditPane } = createAnimationEditPane({
    onClose: () => {
      editPaneEl.hidden = true
      listView.hidden = false
    }
  })
  panel.appendChild(editPaneEl)

  // ── rendering ─────────────────────────────────────────────────────────────

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

    const editBtn = document.createElement('button')
    editBtn.type = 'button'
    editBtn.className = 'perform-animate-edit-btn'
    editBtn.setAttribute('aria-label', `Edit animation ${row.name}`)
    editBtn.textContent = '✎'
    editBtn.addEventListener('click', () => {
      const record = /** @type {Record<string, unknown> | undefined} */ (
        projectGraph.getAnimations().get(row.guid)
      )
      if (!record) return
      listView.hidden = true
      openEditPane(record)
    })

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

    const statusEl = document.createElement('span')
    statusEl.className = 'perform-animate-row__status'
    statusEl.textContent = getAnimationStatusMessage(row.guid)
    label.appendChild(statusEl)

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

    el.appendChild(editBtn)
    el.appendChild(label)
    el.appendChild(toggle)
    return el
  }

  projectGraph.subscribe(render)
  subscribeAnimationPlayState(render)
  render()

  return { panel }
}
