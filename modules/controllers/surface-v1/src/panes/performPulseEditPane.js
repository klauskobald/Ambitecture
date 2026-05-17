import { projectGraph } from '../core/projectGraph.js'
import { sendPulseControlCommand } from '../core/outboundQueue.js'
import * as Modal from '../core/Modal.js'
import { pickChoice } from '../core/Modal.js'

/**
 * @param {string | undefined} bucketGuid
 * @returns {string}
 */
function resolveBucketLabel (bucketGuid) {
  if (!bucketGuid) return 'Empty'
  const bucket = [...projectGraph.getPulseBuckets()].find(
    b => b.guid === bucketGuid
  )
  const name = bucket && typeof bucket.name === 'string' ? bucket.name : ''
  return name.length > 0 ? name : bucketGuid
}

/**
 * Edit pane for a single pulse setup (BPM, slot count, slot→bucket mapping).
 *
 * @param {{ onClose: () => void }} opts
 * @returns {{ el: HTMLElement, open: (setup: Record<string, unknown>) => void }}
 */
export function createPulseEditPane ({ onClose }) {
  const el = document.createElement('div')
  el.className = 'perform-pulse-edit'
  el.hidden = true

  const topRow = document.createElement('div')
  topRow.className = 'perform-pulse-edit__top'

  const backBtn = document.createElement('button')
  backBtn.type = 'button'
  backBtn.className = 'perform-pulse-edit__back'
  backBtn.textContent = '←'
  backBtn.addEventListener('click', () => {
    el.hidden = true
    onClose()
  })

  const nameLabel = document.createElement('button')
  nameLabel.type = 'button'
  nameLabel.className = 'perform-pulse-edit__name'
  nameLabel.title = 'Edit pulse name'

  const deleteBtn = document.createElement('button')
  deleteBtn.type = 'button'
  deleteBtn.className = 'perform-pulse-edit__delete btn--danger'
  deleteBtn.textContent = '❌'

  topRow.appendChild(backBtn)
  topRow.appendChild(nameLabel)
  topRow.appendChild(deleteBtn)

  const body = document.createElement('div')
  body.className = 'perform-pulse-edit__body'

  el.appendChild(topRow)
  el.appendChild(body)

  /** @type {string} */
  let currentGuid = ''

  /** @param {Record<string, unknown>} setup */
  function renderBody (setup) {
    body.replaceChildren()

    const bpmField = document.createElement('label')
    bpmField.className = 'perform-pulse-edit__field'
    const bpmLabel = document.createElement('span')
    bpmLabel.textContent = 'BPM'
    const bpmInput = document.createElement('input')
    bpmInput.type = 'number'
    bpmInput.min = '20'
    bpmInput.max = '300'
    bpmInput.step = '1'
    bpmInput.className = 'perform-pulse-edit__input'
    bpmInput.value = String(setup.bpm ?? 120)
    bpmInput.addEventListener('change', () => {
      const next = Number(bpmInput.value)
      if (!Number.isFinite(next)) return
      sendPulseControlCommand({
        command: 'setSetupBpm',
        setupGuid: currentGuid,
        bpm: next
      })
    })
    bpmField.appendChild(bpmLabel)
    bpmField.appendChild(bpmInput)
    body.appendChild(bpmField)

    const slotsField = document.createElement('label')
    slotsField.className = 'perform-pulse-edit__field'
    const slotsLabel = document.createElement('span')
    slotsLabel.textContent = 'Slots'
    const slotsInput = document.createElement('input')
    slotsInput.type = 'number'
    slotsInput.min = '1'
    slotsInput.max = '32'
    slotsInput.step = '1'
    slotsInput.className = 'perform-pulse-edit__input'
    const slots = Array.isArray(setup.slots) ? setup.slots : []
    slotsInput.value = String(slots.length)
    slotsInput.addEventListener('change', () => {
      const next = Number(slotsInput.value)
      if (!Number.isFinite(next)) return
      sendPulseControlCommand({
        command: 'setSetupSlotCount',
        setupGuid: currentGuid,
        count: next
      })
    })
    slotsField.appendChild(slotsLabel)
    slotsField.appendChild(slotsInput)
    body.appendChild(slotsField)

    const slotList = document.createElement('div')
    slotList.className = 'perform-pulse-edit__slots'
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i]
      const bucketGuid =
        slot &&
        typeof slot === 'object' &&
        !Array.isArray(slot) &&
        typeof slot.bucket === 'string' &&
        slot.bucket.length > 0
          ? slot.bucket
          : undefined
      const rowBtn = document.createElement('button')
      rowBtn.type = 'button'
      rowBtn.className = 'perform-pulse-edit__slot-row'
      rowBtn.textContent = `Slot ${i + 1}: ${resolveBucketLabel(bucketGuid)}`
      rowBtn.addEventListener('click', () => {
        void pickSlotBucket(i)
      })
      slotList.appendChild(rowBtn)
    }
    body.appendChild(slotList)
  }

  /** @param {number} slotIdx */
  async function pickSlotBucket (slotIdx) {
    const options = [
      { value: '', label: 'None' },
      ...[...projectGraph.getPulseBuckets()].map(b => ({
        value: String(b.guid ?? ''),
        label: typeof b.name === 'string' && b.name ? b.name : String(b.guid ?? '')
      }))
    ]
    const choice = await pickChoice('Assign bucket to slot', options)
    if (choice === null) return
    sendPulseControlCommand({
      command: 'assignSlotBucket',
      setupGuid: currentGuid,
      slotIdx,
      bucketGuid: choice.length > 0 ? choice : null
    })
  }

  /** @param {Record<string, unknown>} setup */
  function open (setup) {
    const guid = typeof setup.guid === 'string' ? setup.guid : ''
    if (!guid) return
    currentGuid = guid
    const name = typeof setup.name === 'string' ? setup.name : guid
    nameLabel.textContent = name

    nameLabel.onclick = async () => {
      const result = await Modal.prompt('Edit pulse name', [
        { label: 'Name', key: 'name', value: name }
      ])
      if (!result || typeof result.name !== 'string') return
      const trimmed = result.name.trim()
      if (trimmed.length === 0) return
      sendPulseControlCommand({
        command: 'renameSetup',
        setupGuid: currentGuid,
        name: trimmed
      })
      nameLabel.textContent = trimmed
    }

    deleteBtn.onclick = async () => {
      const pulseName = String(nameLabel.textContent ?? currentGuid)
      const ok = await Modal.confirm(`Delete pulse "${pulseName}"?`, {
        yes: 'Delete',
        no: 'Cancel'
      })
      if (!ok) return
      sendPulseControlCommand({
        command: 'deleteSetup',
        setupGuid: currentGuid
      })
      el.hidden = true
      onClose()
    }

    el.hidden = false
    renderBody(setup)
  }

  projectGraph.subscribe(['pulses'], () => {
    if (el.hidden || !currentGuid) return
    const setup = projectGraph.getPulseSetup(currentGuid)
    if (!setup) {
      el.hidden = true
      onClose()
      return
    }
    const name = typeof setup.name === 'string' ? setup.name : currentGuid
    nameLabel.textContent = name
    renderBody(setup)
  })

  return { el, open }
}

