/**
 * Perform → Pulse subpane: list pulse setups, select active pulse, edit setup/slots.
 */

import { projectGraph } from '../core/projectGraph.js'
import { sendPulseControlCommand } from '../core/outboundQueue.js'
import {
  getPulseSlotStatus,
  subscribePulsePlayState,
  isPulseActive
} from '../core/pulsePlayRegistry.js'
import { formatPulseBpmDisplay } from '../core/pulseFormat.js'
import { createPulseEditPane } from './performPulseEditPane.js'
import { createPerformPulseSyncColumn } from './performPulseSyncColumn.js'
import { prompt as modalPrompt } from '../core/Modal.js'

/**
 * Hub `slotIdx` is the slot that just fired. Rebuild each update so only that segment is orange.
 *
 * @param {number} slotsTotal
 * @param {number} firedSlotIdx
 * @param {number} bpm
 * @returns {HTMLElement}
 */
function renderSlotMeter (slotsTotal, firedSlotIdx, bpm) {
  const meter = document.createElement('div')
  meter.className = 'perform-pulse-meter'
  const beatMs =
    typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0
      ? (60 / bpm) * 1000
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
  panel.hidden = true

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
        const slots = Array.isArray(s.slots) ? s.slots.length : 0
        return `${guid}:${name}:${bpm}:${slots}`
      })
      .join('|')
  }

  /** @param {HTMLElement} rowEl */
  function syncRowState (rowEl) {
    const guid = rowEl.dataset.pulseGuid
    if (!guid) return
    const setup = projectGraph.getPulseSetup(guid)
    const status = getPulseSlotStatus(guid)
    rowEl.classList.toggle('perform-pulse-row--active', status.isActive)
    const bpmEl = rowEl.querySelector('.perform-pulse-row__head .perform-pulse-row__bpm')
    if (bpmEl && setup) {
      bpmEl.textContent = `${formatPulseBpmDisplay(displayBpmForSetup(guid, setup))} bpm`
    }
    const statusHost = rowEl.querySelector('.perform-pulse-row__status')
    if (!statusHost) return
    if (status.isActive && status.slotsTotal > 0) {
      statusHost.replaceChildren(
        renderSlotMeter(status.slotsTotal, status.slotIdx, status.bpm)
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

    const selectBtn = document.createElement('button')
    selectBtn.type = 'button'
    selectBtn.className = 'perform-pulse-select'
    selectBtn.setAttribute('aria-label', `Select pulse ${name}`)
    selectBtn.textContent = '▶'
    selectBtn.addEventListener('pointerdown', event => {
      event.preventDefault()
      selectBtn.classList.add('perform-input--pressed')
      sendPulseControlCommand({ command: 'selectSetup', setupGuid: guid })
    })
    selectBtn.addEventListener('pointerup', () => {
      selectBtn.classList.remove('perform-input--pressed')
    })
    selectBtn.addEventListener('pointercancel', () => {
      selectBtn.classList.remove('perform-input--pressed')
    })
    selectBtn.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
    })

    el.appendChild(editBtn)
    el.appendChild(label)
    el.appendChild(selectBtn)
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

