/**
 * Perform → Animate subpane: list project animations with play / stop (hub `action:trigger` + `args.command`).
 */

import { projectGraph } from '../core/projectGraph.js'
import { sendActionTrigger, sendBindingSet } from '../core/outboundQueue.js'
import {
  isAnimationPlaying,
  getAnimationStatusMessage,
  subscribeAnimationPlayState
} from '../core/animationPlayRegistry.js'
import { subscribeBinding } from '../core/bindingRegistry.js'
import { getAnimatorViewer } from './animators/animatorViewerRegistry.js'
import { createAnimationEditPane } from './performAnimateEditPane.js'

const SPEED_PRESETS = [0.25, 0.5, 1, 1.5, 2, 4]
const DEFAULT_SPEED_IDX = SPEED_PRESETS.indexOf(1)

/** @type {Map<string, number>} guid → index into SPEED_PRESETS */
const speedIndexByGuid = new Map()

function formatSpeed (v) {
  return v === 1 ? '1×' : `${v}×`
}

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

  let lastListKey = ''

  function listKey (anims) {
    return anims.map(a => `${a.guid}:${a.name}:${a.class}`).join('|')
  }

  function syncRowPlayState (rowEl) {
    const guid = rowEl.dataset.animationGuid
    if (!guid) return
    const statusEl = rowEl.querySelector('.perform-animate-row__status')
    if (statusEl) statusEl.textContent = getAnimationStatusMessage(guid)
    const toggle = rowEl.querySelector('.perform-animate-toggle')
    if (!toggle) return
    const playing = isAnimationPlaying(guid)
    const name = rowEl.querySelector('.perform-animate-row__name')?.textContent ?? guid
    toggle.classList.toggle('perform-animate-toggle--stop', playing)
    toggle.classList.toggle('perform-animate-toggle--play', !playing)
    toggle.setAttribute('aria-label', playing ? `Stop animation ${name}` : `Play animation ${name}`)
    toggle.setAttribute('aria-pressed', playing ? 'true' : 'false')
    toggle.textContent = playing ? '■' : '▶'
  }

  function syncAllRowPlayStates () {
    for (const rowEl of list.querySelectorAll('[data-animation-guid]')) {
      syncRowPlayState(rowEl)
    }
  }

  function render () {
    const anims = projectGraph.getPlayableAnimationsList()
    const key = listKey(anims)
    if (key === lastListKey) {
      syncAllRowPlayStates()
      return
    }
    lastListKey = key
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
        const speedIdx = speedIndexByGuid.get(row.guid) ?? DEFAULT_SPEED_IDX
        const timescale = SPEED_PRESETS[speedIdx] ?? 1
        sendActionTrigger(row.guid, timescale !== 1 ? { command: 'start', timescale } : { command: 'start' })
      }
    })

    const speedDial = makeSpeedDial(row.guid)

    el.appendChild(editBtn)
    el.appendChild(label)
    el.appendChild(speedDial)
    el.appendChild(toggle)
    return el
  }

  /**
   * @param {string} guid
   * @returns {HTMLButtonElement}
   */
  function makeSpeedDial (guid) {
    const key = `${guid}-timescale`
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'perform-animate-speed'

    function syncDial () {
      const idx = speedIndexByGuid.get(guid) ?? DEFAULT_SPEED_IDX
      const speed = SPEED_PRESETS[idx] ?? 1
      btn.textContent = formatSpeed(speed)
      btn.classList.toggle('perform-animate-speed--active', speed !== 1)
      btn.setAttribute('aria-label', `Playback speed: ${formatSpeed(speed)}`)
    }

    subscribeBinding(key, (value) => {
      if (value === null || value === undefined) {
        btn.disabled = true
        return
      }
      btn.disabled = false
      const speed = Number(value)
      const closestIdx = SPEED_PRESETS.reduce(
        (best, p, i) => Math.abs(p - speed) < Math.abs(SPEED_PRESETS[best] - speed) ? i : best,
        DEFAULT_SPEED_IDX
      )
      speedIndexByGuid.set(guid, closestIdx)
      syncDial()
    })

    btn.addEventListener('click', () => {
      const prev = speedIndexByGuid.get(guid) ?? DEFAULT_SPEED_IDX
      const next = (prev + 1) % SPEED_PRESETS.length
      speedIndexByGuid.set(guid, next)
      syncDial()
      sendBindingSet(key, SPEED_PRESETS[next])
    })

    syncDial()
    return btn
  }

  projectGraph.subscribe(render)
  subscribeAnimationPlayState(syncAllRowPlayStates)
  render()

  return { panel }
}
