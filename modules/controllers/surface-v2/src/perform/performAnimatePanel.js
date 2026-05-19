/**
 * Perform → Animate subpane: list project animations with play / stop (`action:trigger` with `args.value` on/off).
 */

import { projectGraph } from '../core/projectGraph.js'
import { sendActionTrigger, sendBindingSet } from '../core/outboundQueue.js'
import {
  isAnimationPlaying,
  isAnimationPaused,
  getAnimationStatusMessage,
  subscribeAnimationPlayState
} from '../core/animationPlayRegistry.js'
import { subscribeBinding } from '../core/bindingRegistry.js'
import { ScalarRadialKnobSvg } from '../edit/components/ScalarRadialKnobSvg.js'
import { getAnimatorViewer } from './animators/animatorViewerRegistry.js'
import { createAnimationEditPane } from './performAnimateEditPane.js'
import { getCapabilities } from '../core/systemCapabilities.js'
import { pickChoice, warn as modalWarn } from '../core/Modal.js'
import { sendGraphCommand } from '../core/outboundQueue.js'
import {
  getPerformIntentFilter,
  setPerformIntentFilter,
  subscribePerformIntentFilter
} from '../core/performIntentFilter.js'

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

  function getIntentFilter () {
    return getPerformIntentFilter()
  }

  /** @param {string | null} guid */
  function setIntentFilter (guid) {
    setPerformIntentFilter(guid)
  }

  /** @param {(guid: string | null) => void} cb */
  function subscribeFilter (cb) {
    return subscribePerformIntentFilter(cb)
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
    const intentFilter = getPerformIntentFilter()
    return (
      anims
        .map(a => `${a.guid}:${a.name}:${a.class}:${a.targetIntent ?? ''}`)
        .join('|') + `#${intentFilter ?? ''}`
    )
  }

  function syncRowPlayState (rowEl) {
    const guid = rowEl.dataset.animationGuid
    if (!guid) return
    const statusEl = rowEl.querySelector('.perform-animate-row__status')
    if (statusEl) statusEl.textContent = getAnimationStatusMessage(guid)
    const toggle = rowEl.querySelector('.perform-animate-toggle')
    if (!toggle) return
    const playing = isAnimationPlaying(guid)
    const paused = isAnimationPaused(guid)
    const name =
      rowEl.querySelector('.perform-animate-row__name')?.textContent ?? guid
    rowEl.classList.toggle('perform-animate-row--playing', playing)
    rowEl.classList.toggle('perform-animate-row--paused', paused)
    toggle.classList.toggle('perform-animate-toggle--stop', playing)
    toggle.classList.toggle('perform-animate-toggle--paused', paused)
    toggle.classList.toggle('perform-animate-toggle--play', !playing && !paused)
    if (playing) {
      toggle.setAttribute('aria-label', `Stop animation ${name}`)
      toggle.setAttribute('aria-pressed', 'true')
      toggle.textContent = '■'
    } else if (paused) {
      toggle.setAttribute('aria-label', `Resume animation ${name}`)
      toggle.setAttribute('aria-pressed', 'mixed')
      toggle.textContent = '⏸'
    } else {
      toggle.setAttribute('aria-label', `Play animation ${name}`)
      toggle.setAttribute('aria-pressed', 'false')
      toggle.textContent = '▶'
    }
  }

  function syncAllRowPlayStates () {
    for (const rowEl of list.querySelectorAll('[data-animation-guid]')) {
      syncRowPlayState(rowEl)
    }
  }

  function render () {
    const intentFilter = getPerformIntentFilter()
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
      if (intentFilter) list.appendChild(makeFilteredIntentCreateButton(intentFilter))
      return
    }
    for (const row of anims) {
      list.appendChild(makeRow(row))
    }
    if (intentFilter) list.appendChild(makeFilteredIntentCreateButton(intentFilter))
  }

  /**
   * @param {string} targetIntentGuid
   * @returns {HTMLButtonElement}
   */
  function makeFilteredIntentCreateButton (targetIntentGuid) {
    const createBtn = document.createElement('button')
    createBtn.type = 'button'
    createBtn.className = 'btn perform-animate-empty__create'
    createBtn.textContent = 'Create'
    createBtn.addEventListener('click', () => {
      void createAnimationForFilteredIntent(targetIntentGuid)
    })
    return createBtn
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
      const paused = isAnimationPaused(row.guid)
      el.classList.toggle('perform-animate-row--playing', playing)
      el.classList.toggle('perform-animate-row--paused', paused)
      toggle.classList.toggle('perform-animate-toggle--stop', playing)
      toggle.classList.toggle('perform-animate-toggle--paused', paused)
      toggle.classList.toggle('perform-animate-toggle--play', !playing && !paused)
      if (playing) {
        toggle.setAttribute('aria-label', `Stop animation ${row.name}`)
        toggle.setAttribute('aria-pressed', 'true')
        toggle.textContent = '■'
      } else if (paused) {
        toggle.setAttribute('aria-label', `Resume animation ${row.name}`)
        toggle.setAttribute('aria-pressed', 'mixed')
        toggle.textContent = '⏸'
      } else {
        toggle.setAttribute('aria-label', `Play animation ${row.name}`)
        toggle.setAttribute('aria-pressed', 'false')
        toggle.textContent = '▶'
      }
    }

    syncToggle()
    toggle.addEventListener('pointerdown', event => {
      event.preventDefault()
      toggle.classList.add('perform-input--pressed')
      if (isAnimationPlaying(row.guid)) {
        sendActionTrigger(row.guid, { value: 'off' })
      } else if (isAnimationPaused(row.guid)) {
        sendActionTrigger(row.guid, { value: 'on' })
      } else {
        sendActionTrigger(row.guid, { value: 'on' })
      }
    })
    toggle.addEventListener('pointerup', () => {
      toggle.classList.remove('perform-input--pressed')
    })
    toggle.addEventListener('pointercancel', () => {
      toggle.classList.remove('perform-input--pressed')
    })
    toggle.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
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
    const timescaleMin = 0.125
    const timescaleMax = 16
    const recipMin = 1 / timescaleMax
    const recipMax = 1 / timescaleMin
    let currentTimescale = 1

    const wrap = document.createElement('div')
    wrap.className = 'perform-animate-speed-wrap'

    const knob = new ScalarRadialKnobSvg({
      descriptor: {
        name: 'Speed',
        range: [recipMin, recipMax],
        step: 0.01,
        defaultValue: 1,
        stepFunction: 'quadratic'
      },
      intentGuid: guid,
      readValue: () => {
        const ts = currentTimescale
        if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return 1
        return 1 / ts
      },
      onCommit: domain => {
        const r = Number(domain)
        if (!Number.isFinite(r) || r <= 0) return
        sendBindingSet(key, 1 / r)
      }
    })
    knob.mount(wrap)

    subscribeBinding(key, value => {
      if (value === null || value === undefined) {
        wrap.classList.add('perform-animate-speed-wrap--offline')
        return
      }
      wrap.classList.remove('perform-animate-speed-wrap--offline')
      currentTimescale = Number(value)
      knob.syncFromExternal()
    })

    return wrap
  }

  // Re-render row list when animations / actions / intent definitions change.
  // Runtime intent patches (animation frames) are intentionally excluded.
  projectGraph.subscribe(['animations', 'actions', 'intents:def'], render)
  subscribePerformIntentFilter(() => render())
  subscribeAnimationPlayState(syncAllRowPlayStates)
  render()

  /**
   * @param {string} targetIntentGuid
   * @returns {Promise<void>}
   */
  async function createAnimationForFilteredIntent (targetIntentGuid) {
    const caps = getCapabilities()
    const animationCaps = Array.isArray(caps?.animations) ? caps.animations : []
    const options = animationCaps
      .map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item))
          return null
        const row = /** @type {Record<string, unknown>} */ (item)
        const cls = typeof row.class === 'string' ? row.class : ''
        if (!cls) return null
        const viewer = getAnimatorViewer(cls)
        const label =
          viewer?.getName() ??
          (typeof row.name === 'string' && row.name ? row.name : cls)
        return { value: cls, label }
      })
      .filter(Boolean)
    if (options.length === 0) {
      await modalWarn('No animator classes available.')
      return
    }
    const choice = await pickChoice('Create animation type', options, {
      scrollKey: 'animate.create-type'
    })
    if (!choice) return

    const suffix =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const guid = `anim-${suffix}`
    const intentName = resolveIntentName(targetIntentGuid)
    const value = {
      guid,
      class: choice,
      name: intentName,
      targetIntent: targetIntentGuid
    }
    sendGraphCommand({
      op: 'upsert',
      entityType: 'animation',
      guid,
      value,
      persistence: 'runtimeAndDurable'
    })
    projectGraph.applyGraphDelta({
      entityType: 'animation',
      op: 'upsert',
      guid,
      value
    })
  }

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
