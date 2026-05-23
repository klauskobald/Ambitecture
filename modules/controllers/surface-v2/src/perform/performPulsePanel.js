/**
 * Perform → Pulse subpane: list pulse setups with play / stop (`pulse:control` startSetup / stopSetup).
 */

import { projectGraph } from '../core/projectGraph.js'
import { sendPulseControlCommand } from '../core/outboundQueue.js'
import {
  getPulseSlotStatus,
  subscribePulsePlayState,
  isPulseActive
} from '../core/pulsePlayRegistry.js'
import {
  formatPulseBpmDisplay,
  clampPulseSetupSpeed,
  formatPulseSpeedLabel,
  PULSE_SPEED_MIN,
  PULSE_SPEED_MAX
} from '../core/pulseFormat.js'
import { createPulseEditPane } from './performPulseEditPane.js'
import { createPerformPulseSyncColumn } from './performPulseSyncColumn.js'
import { prompt as modalPrompt } from '../core/Modal.js'

/**
 * Hub `slotIdx` is the slot that just fired. Rebuild each update so only that segment is orange.
 *
 * @param {number} slotsTotal
 * @param {number} firedSlotIdx
 * @param {number} bpm
 * @param {number} speed
 * @returns {HTMLElement}
 */
function renderSlotMeter (slotsTotal, firedSlotIdx, bpm, speed) {
  const meter = document.createElement('div')
  meter.className = 'perform-pulse-meter'
  const s =
    typeof speed === 'number' && Number.isFinite(speed) && speed > 0 ? speed : 1
  const beatMs =
    typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0
      ? (60 / (bpm * s)) * 1000
      : 500
  meter.style.setProperty('--pulse-beat-period', `${beatMs}ms`)
  for (let i = 0; i < slotsTotal; i += 1) {
    const block = document.createElement('span')
    block.className = 'perform-pulse-meter__slot'
    if (i === firedSlotIdx) {
      block.classList.add('perform-pulse-meter__slot--current')
    }
    block.setAttribute('aria-hidden', 'true')
    meter.appendChild(block)
  }
  return meter
}

/**
 * @param {string} guid
 * @param {Record<string, unknown>} setup
 * @returns {number}
 */
function displayBpmForSetup (guid, setup) {
  if (isPulseActive(guid)) {
    return getPulseSlotStatus(guid).bpm
  }
  const bpm = setup.bpm
  return typeof bpm === 'number' && Number.isFinite(bpm) ? bpm : 120
}

/**
 * @returns {{ panel: HTMLDivElement }}
 */
export function createPerformPulsePanel () {
  const panel = document.createElement('div')
  panel.className = 'perform-subpane perform-subpane--pulse'

  const listView = document.createElement('div')
  listView.className = 'perform-pulse-list-view'

  const list = document.createElement('div')
  list.className = 'perform-pulse-list'
  list.setAttribute('role', 'list')

  listView.appendChild(list)

  const main = document.createElement('div')
  main.className = 'perform-pulse-main'
  const { el: syncCol, refresh: refreshSyncCol } = createPerformPulseSyncColumn()
  main.appendChild(syncCol)
  main.appendChild(listView)
  panel.appendChild(main)

  const { el: editPaneEl, open: openEditPane } = createPulseEditPane({
    onClose: () => {
      editPaneEl.hidden = true
      main.hidden = false
    }
  })
  panel.appendChild(editPaneEl)

  let lastListKey = ''

  async function createPulseSetup () {
    const result = await modalPrompt('Create pulse setup', [
      { label: 'Name', key: 'name', value: '' }
    ])
    const name =
      result && typeof result.name === 'string' ? result.name.trim() : ''
    sendPulseControlCommand({
      command: 'createSetup',
      ...(name.length > 0 ? { name } : {})
    })
  }

  /**
   * @param {Record<string, unknown>} setup
   * @returns {string}
   */
  function pulseSetupDisplayName (setup) {
    const name = typeof setup.name === 'string' ? setup.name : ''
    const guid = typeof setup.guid === 'string' ? setup.guid : ''
    return name || guid
  }

  /**
   * @param {Record<string, unknown>[]} setups
   * @returns {Record<string, unknown>[]}
   */
  function sortedPulseSetups (setups) {
    return [...setups].sort((a, b) =>
      pulseSetupDisplayName(a).localeCompare(
        pulseSetupDisplayName(b),
        undefined,
        { sensitivity: 'base' }
      )
    )
  }

  /** @param {Record<string, unknown>[]} setups */
  function listKey (setups) {
    return sortedPulseSetups(setups)
      .map(s => {
        const guid = typeof s.guid === 'string' ? s.guid : ''
        const name = typeof s.name === 'string' ? s.name : ''
        const bpm = typeof s.bpm === 'number' ? s.bpm : 0
        const speed = typeof s.speed === 'number' ? s.speed : 1
        const slots = Array.isArray(s.slots) ? s.slots.length : 0
        return `${guid}:${name}:${bpm}:${speed}:${slots}`
      })
      .join('|')
  }

  /** @param {HTMLElement} rowEl */
  function syncRowState (rowEl) {
    const guid = rowEl.dataset.pulseGuid
    if (!guid) return
    const setup = projectGraph.getPulseSetup(guid)
    const status = getPulseSlotStatus(guid)
    const bpmEl = rowEl.querySelector('.perform-pulse-row__head .perform-pulse-row__bpm')
    if (bpmEl && setup) {
      bpmEl.textContent = `${formatPulseBpmDisplay(displayBpmForSetup(guid, setup))} bpm`
    }
    const statusHost = rowEl.querySelector('.perform-pulse-row__status')
    if (statusHost) {
      if (status.isActive && status.slotsTotal > 0) {
        statusHost.replaceChildren(
          renderSlotMeter(
            status.slotsTotal,
            status.slotIdx,
            status.bpm,
            status.speed
          )
        )
      } else if (status.message) {
        statusHost.replaceChildren()
        const text = document.createElement('span')
        text.className = 'perform-pulse-row__status-text'
        text.textContent = status.message
        statusHost.appendChild(text)
      } else {
        statusHost.replaceChildren()
      }
    }
    const toggle = rowEl.querySelector('.perform-pulse-toggle')
    if (toggle) {
      const playing = isPulseActive(guid)
      const name =
        rowEl.querySelector('.perform-pulse-row__name')?.textContent ?? guid
      rowEl.classList.toggle('perform-pulse-row--active', playing)
      toggle.classList.toggle('perform-pulse-toggle--stop', playing)
      toggle.classList.toggle('perform-pulse-toggle--play', !playing)
      if (playing) {
        toggle.setAttribute('aria-label', `Stop pulse ${name}`)
        toggle.setAttribute('aria-pressed', 'true')
        toggle.textContent = '■'
      } else {
        toggle.setAttribute('aria-label', `Play pulse ${name}`)
        toggle.setAttribute('aria-pressed', 'false')
        toggle.textContent = '▶'
      }
    }
    const speedVal = rowEl.querySelector('.perform-pulse-row__speed-value')
    const minusBtn = rowEl.querySelector('.perform-pulse-speed-btn--minus')
    const plusBtn = rowEl.querySelector('.perform-pulse-speed-btn--plus')
    if (setup && speedVal) {
      const sp =
        typeof setup.speed === 'number' && Number.isFinite(setup.speed)
          ? setup.speed
          : 1
      const clamped = clampPulseSetupSpeed(sp)
      speedVal.textContent = formatPulseSpeedLabel(clamped)
      if (minusBtn instanceof HTMLButtonElement) {
        minusBtn.disabled = clamped <= PULSE_SPEED_MIN
      }
      if (plusBtn instanceof HTMLButtonElement) {
        plusBtn.disabled = clamped >= PULSE_SPEED_MAX
      }
    }
  }

  function syncAllRowStates () {
    for (const rowEl of list.querySelectorAll('[data-pulse-guid]')) {
      syncRowState(rowEl)
    }
  }

  /** @param {Record<string, unknown>} setup */
  function makeRow (setup) {
    const guid = typeof setup.guid === 'string' ? setup.guid : ''
    const name = typeof setup.name === 'string' ? setup.name : guid

    const el = document.createElement('div')
    el.className = 'perform-pulse-row'
    el.setAttribute('role', 'listitem')
    el.dataset.pulseGuid = guid

    const editBtn = document.createElement('button')
    editBtn.type = 'button'
    editBtn.className = 'perform-pulse-edit-btn'
    editBtn.setAttribute('aria-label', `Edit pulse ${name}`)
    editBtn.textContent = '✎'
    editBtn.addEventListener('click', () => {
      const record = projectGraph.getPulseSetup(guid)
      if (!record) return
      main.hidden = true
      openEditPane(record)
    })

    const label = document.createElement('div')
    label.className = 'perform-pulse-row__label'

    const head = document.createElement('div')
    head.className = 'perform-pulse-row__head'

    const title = document.createElement('span')
    title.className = 'perform-pulse-row__name'
    title.textContent = name
    const bpmEl = document.createElement('span')
    bpmEl.className = 'perform-pulse-row__bpm'
    bpmEl.textContent = `${formatPulseBpmDisplay(displayBpmForSetup(guid, setup))} bpm`

    head.appendChild(title)
    head.appendChild(bpmEl)
    label.appendChild(head)

    const statusEl = document.createElement('div')
    statusEl.className = 'perform-pulse-row__status'
    label.appendChild(statusEl)

    const speedWrap = document.createElement('div')
    speedWrap.className = 'perform-pulse-row__speed'
    speedWrap.setAttribute('role', 'group')
    speedWrap.setAttribute('aria-label', `Pulse speed for ${name}`)

    const minusBtn = document.createElement('button')
    minusBtn.type = 'button'
    minusBtn.className =
      'btn perform-pulse-speed-btn perform-pulse-speed-btn--minus'
    minusBtn.setAttribute('aria-label', 'Slower pulse (half speed step)')
    minusBtn.textContent = '−'
    minusBtn.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      const rec = projectGraph.getPulseSetup(guid)
      const raw =
        rec && typeof rec.speed === 'number' && Number.isFinite(rec.speed)
          ? rec.speed
          : 1
      const cur = clampPulseSetupSpeed(raw)
      sendPulseControlCommand({
        command: 'setSetupSpeed',
        setupGuid: guid,
        speed: clampPulseSetupSpeed(cur * 0.5)
      })
    })

    const speedVal = document.createElement('span')
    speedVal.className = 'perform-pulse-row__speed-value'
    const sp0 =
      typeof setup.speed === 'number' && Number.isFinite(setup.speed)
        ? setup.speed
        : 1
    speedVal.textContent = formatPulseSpeedLabel(clampPulseSetupSpeed(sp0))

    const plusBtn = document.createElement('button')
    plusBtn.type = 'button'
    plusBtn.className =
      'btn perform-pulse-speed-btn perform-pulse-speed-btn--plus'
    plusBtn.setAttribute('aria-label', 'Faster pulse (double speed step)')
    plusBtn.textContent = '+'
    plusBtn.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      const rec = projectGraph.getPulseSetup(guid)
      const raw =
        rec && typeof rec.speed === 'number' && Number.isFinite(rec.speed)
          ? rec.speed
          : 1
      const cur = clampPulseSetupSpeed(raw)
      sendPulseControlCommand({
        command: 'setSetupSpeed',
        setupGuid: guid,
        speed: clampPulseSetupSpeed(cur * 2)
      })
    })

    speedWrap.appendChild(minusBtn)
    speedWrap.appendChild(speedVal)
    speedWrap.appendChild(plusBtn)

    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'perform-pulse-toggle perform-pulse-toggle--play'
    toggle.addEventListener('pointerdown', event => {
      event.preventDefault()
      toggle.classList.add('perform-input--pressed')
      if (isPulseActive(guid)) {
        sendPulseControlCommand({ command: 'stopSetup', setupGuid: guid })
      } else {
        sendPulseControlCommand({ command: 'startSetup', setupGuid: guid })
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

    el.appendChild(editBtn)
    el.appendChild(label)
    el.appendChild(speedWrap)
    el.appendChild(toggle)
    syncRowState(el)
    return el
  }

  function renderList () {
    const setups = sortedPulseSetups(projectGraph.getPulseSetups())
    const key = listKey(setups)
    if (key === lastListKey) {
      syncAllRowStates()
      return
    }
    lastListKey = key
    list.replaceChildren()
    if (setups.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'perform-pulse-empty'
      empty.textContent = 'No pulse setups in project.'
      list.appendChild(empty)
    } else {
      for (const setup of setups) {
        list.appendChild(makeRow(setup))
      }
    }
    const footer = document.createElement('div')
    footer.className = 'perform-pulse-footer'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'btn perform-pulse-empty__create'
    btn.textContent = 'Create pulse'
    btn.addEventListener('click', () => {
      void createPulseSetup()
    })
    footer.appendChild(btn)
    list.appendChild(footer)
  }

  function onPulsesChanged () {
    refreshSyncCol()
    renderList()
  }

  projectGraph.subscribe(['pulses'], onPulsesChanged)
  subscribePulsePlayState(syncAllRowStates)
  refreshSyncCol()
  renderList()

  return { panel }
}

