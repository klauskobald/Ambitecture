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
import { ScalarRadialKnobSvg } from '../edit/components/ScalarRadialKnobSvg.js'
import { getAnimatorViewer } from './animators/animatorViewerRegistry.js'
import { createAnimationEditPane } from './performAnimateEditPane.js'

/**
 * @returns {{
 *   panel: HTMLDivElement,
 *   getIntentFilter: () => string | null,
 *   setIntentFilter: (guid: string | null) => void,
 *   subscribeFilter: (cb: (guid: string | null) => void) => () => void
 * }}
 */
export function createPerformAnimatePanel () {
  const panel = document.createElement('div')
  panel.className = 'perform-subpane perform-subpane--animate'
  panel.hidden = true

  /** @type {string | null} */
  let intentFilter = null
  /** @type {Set<(guid: string | null) => void>} */
  const filterListeners = new Set()

  function getIntentFilter () {
    return intentFilter
  }

  /** @param {string | null} guid */
  function setIntentFilter (guid) {
    const next = guid || null
    if (next === intentFilter) return
    intentFilter = next
    for (const cb of filterListeners) cb(intentFilter)
    render()
  }

  /** @param {(guid: string | null) => void} cb */
  function subscribeFilter (cb) {
    filterListeners.add(cb)
    return () => filterListeners.delete(cb)
  }

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
    return anims
      .map(a => `${a.guid}:${a.name}:${a.class}:${a.targetIntent ?? ''}`)
      .join('|') + `#${intentFilter ?? ''}`
  }

  function syncRowPlayState (rowEl) {
    const guid = rowEl.dataset.animationGuid
    if (!guid) return
    const statusEl = rowEl.querySelector('.perform-animate-row__status')
    if (statusEl) statusEl.textContent = getAnimationStatusMessage(guid)
    const toggle = rowEl.querySelector('.perform-animate-toggle')
    if (!toggle) return
    const playing = isAnimationPlaying(guid)
    const name =
      rowEl.querySelector('.perform-animate-row__name')?.textContent ?? guid
    toggle.classList.toggle('perform-animate-toggle--stop', playing)
    toggle.classList.toggle('perform-animate-toggle--play', !playing)
    toggle.setAttribute(
      'aria-label',
      playing ? `Stop animation ${name}` : `Play animation ${name}`
    )
    toggle.setAttribute('aria-pressed', playing ? 'true' : 'false')
    toggle.textContent = playing ? '■' : '▶'
  }

  function syncAllRowPlayStates () {
    for (const rowEl of list.querySelectorAll('[data-animation-guid]')) {
      syncRowPlayState(rowEl)
    }
  }

  function render () {
    const allAnims = projectGraph.getPlayableAnimationsList()
    const anims = intentFilter
      ? allAnims.filter(a => a.targetIntent === intentFilter)
      : allAnims
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
      empty.textContent = intentFilter
        ? `No animations targeting ${resolveIntentName(intentFilter)}.`
        : 'No animations in project.'
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

    const speedDial = makeSpeedDial(row.guid)
    const intentEl = document.createElement('span')
    intentEl.className = 'perform-animate-row__intent'
    intentEl.textContent = resolveIntentName(row.targetIntent)

    el.appendChild(editBtn)
    el.appendChild(label)
    el.appendChild(intentEl)
    el.appendChild(speedDial)
    el.appendChild(toggle)
    return el
  }

  /**
   * @param {string} guid
   * @returns {HTMLDivElement}
   */
  function makeSpeedDial (guid) {
    const key = `${guid}-timescale`
    let currentSpeed = 1

    const wrap = document.createElement('div')
    wrap.className = 'perform-animate-speed-wrap'

    const knob = new ScalarRadialKnobSvg({
      descriptor: {
        name: 'Speed',
        range: [0.25, 4],
        step: 0.01,
        defaultValue: 1
      },
      intentGuid: guid,
      readValue: () => currentSpeed,
      onCommit: domain => sendBindingSet(key, domain)
    })
    knob.mount(wrap)

    subscribeBinding(key, value => {
      if (value === null || value === undefined) {
        wrap.classList.add('perform-animate-speed-wrap--offline')
        return
      }
      wrap.classList.remove('perform-animate-speed-wrap--offline')
      currentSpeed = Number(value)
      knob.syncFromExternal()
    })

    return wrap
  }

  projectGraph.subscribe(render)
  subscribeAnimationPlayState(syncAllRowPlayStates)
  render()

  return { panel, getIntentFilter, setIntentFilter, subscribeFilter }
}

/** @param {string} guid */
function resolveIntentName (guid) {
  if (!guid) return ''
  const intent = /** @type {Record<string, unknown> | undefined} */ (
    projectGraph.getIntents().get(guid)
  )
  const name = intent?.name
  return typeof name === 'string' && name ? name : guid
}
