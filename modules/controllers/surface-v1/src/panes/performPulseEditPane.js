import { projectGraph } from '../core/projectGraph.js'
import { sendPulseControlCommand } from '../core/outboundQueue.js'
import * as Modal from '../core/Modal.js'
import { pickChoice } from '../core/Modal.js'
import { ScalarRadialKnobSvg } from '../edit/components/ScalarRadialKnobSvg.js'
import { clampPulseBpm } from '../core/pulseFormat.js'
import { createPulseTapButton } from '../edit/components/PulseTapButton.js'
import {
  getPulseSlotStatus,
  subscribePulsePlayState,
  isPulseActive
} from '../core/pulsePlayRegistry.js'

/**
 * @param {string | undefined} bucketGuid
 * @returns {string}
 */
/**
 * @param {unknown} slot
 * @returns {boolean}
 */
function isSlotActive (slot) {
  return (
    slot !== null &&
    typeof slot === 'object' &&
    !Array.isArray(slot) &&
    /** @type {Record<string, unknown>} */ (slot).active === true
  )
}

function resolveBucketLabel (bucketGuid) {
  if (!bucketGuid) return ''
  const bucket = [...projectGraph.getPulseBuckets()].find(
    b => b.guid === bucketGuid
  )
  const name = bucket && typeof bucket.name === 'string' ? bucket.name : ''
  return name.length > 0 ? name : bucketGuid
}

/**
 * @param {unknown} action
 * @returns {{ text: string, kind: 'scene' | 'animation' | 'other' } | null}
 */
function chipForPulseBucketAction (action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    return null
  }
  const row = /** @type {Record<string, unknown>} */ (action)
  const raw = row.execute
  const ex =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? /** @type {Record<string, unknown>} */ (raw)
      : null
  if (
    ex?.type === 'scene' &&
    typeof ex.guid === 'string' &&
    ex.guid.length > 0
  ) {
    const scene = projectGraph.getScenesData().find(s => s.guid === ex.guid)
    const text =
      typeof scene?.name === 'string' && scene.name.length > 0
        ? scene.name
        : ex.guid
    return { text, kind: 'scene' }
  }
  if (
    ex?.type === 'animation' &&
    typeof ex.guid === 'string' &&
    ex.guid.length > 0
  ) {
    const anim = projectGraph.getAnimations().get(ex.guid)
    const text =
      typeof anim?.name === 'string' && anim.name.length > 0
        ? anim.name
        : ex.guid
    return { text, kind: 'animation' }
  }
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  if (name.length > 0) {
    return { text: name, kind: 'other' }
  }
  return null
}

/**
 * @param {Record<string, unknown>} bucket
 * @returns {Array<{ text: string, kind: 'scene' | 'animation' | 'other' }>}
 */
function bucketMemberChips (bucket) {
  const chips = []
  const guids = Array.isArray(bucket.actions) ? bucket.actions : []
  const actions = projectGraph.getActions()
  for (const ag of guids) {
    if (typeof ag !== 'string') continue
    const chip = chipForPulseBucketAction(actions.get(ag))
    if (chip) chips.push(chip)
  }
  return chips
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

  /** @type {number} */
  let currentBpm = 120

  /** @type {ScalarRadialKnobSvg | null} */
  let bpmKnob = null

  /** @param {Record<string, unknown>} setup */
  function readBpmFromSetup (setup) {
    if (isPulseActive(currentGuid)) {
      return getPulseSlotStatus(currentGuid).bpm
    }
    const bpm = setup.bpm
    return typeof bpm === 'number' && Number.isFinite(bpm) ? bpm : 120
  }

  /** @param {Record<string, unknown>} setup */
  function renderBody (setup) {
    body.replaceChildren()
    currentBpm = readBpmFromSetup(setup)

    const bpmCluster = document.createElement('div')
    bpmCluster.className = 'perform-pulse-edit__bpm-cluster'

    const tempoLabel = document.createElement('span')
    tempoLabel.className = 'perform-pulse-edit__tempo-label'
    tempoLabel.textContent = 'Tempo'

    const tapBtn = createPulseTapButton({
      resolveSetupGuid: () => currentGuid,
      className: 'perform-pulse-tap-btn'
    })

    const knobWrap = document.createElement('div')
    knobWrap.className = 'perform-pulse-edit__bpm-knob'

    bpmKnob = new ScalarRadialKnobSvg({
      descriptor: {
        name: 'BPM',
        range: [20, 300],
        step: 0.1,
        defaultValue: 120,
        stepFunction: 'linear'
      },
      intentGuid: currentGuid,
      readValue: () => currentBpm,
      onCommit: domain => {
        const next = clampPulseBpm(domain)
        if (!Number.isFinite(next)) return
        currentBpm = next
        sendPulseControlCommand({
          command: 'setSetupBpm',
          setupGuid: currentGuid,
          bpm: next
        })
      },
      showInnerSvgTitle: false,
      hint: 'BPM'
    })
    bpmKnob.mount(knobWrap)

    bpmCluster.appendChild(tempoLabel)
    bpmCluster.appendChild(knobWrap)
    bpmCluster.appendChild(tapBtn)
    body.appendChild(bpmCluster)

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

    const meter =
      typeof setup.meter === 'number' && Number.isFinite(setup.meter)
        ? setup.meter
        : 4
    if (meter > 2) {
      const modeField = document.createElement('div')
      modeField.className =
        'perform-pulse-edit__field perform-pulse-edit__field--mode'

      const modeLabel = document.createElement('span')
      modeLabel.textContent = 'Mode'

      const modeValue = document.createElement('button')
      modeValue.type = 'button'
      modeValue.className = 'perform-pulse-edit__mode-value'
      const currentMode =
        setup.mode === 'backward' || setup.mode === 'random'
          ? setup.mode
          : 'forward'
      modeValue.textContent = currentMode
      modeValue.addEventListener('click', async () => {
        const choice = await pickChoice(
          'Slot mode',
          [
            { value: 'forward', label: 'forward' },
            { value: 'backward', label: 'backward' },
            { value: 'random', label: 'random' }
          ],
          { selected: currentMode }
        )
        if (!choice || choice === currentMode) return
        sendPulseControlCommand({
          command: 'setSetupMode',
          setupGuid: currentGuid,
          mode: /** @type {'forward' | 'backward' | 'random'} */ (choice)
        })
      })

      modeField.appendChild(modeLabel)
      modeField.appendChild(modeValue)
      body.appendChild(modeField)
    }

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
      const row = document.createElement('div')
      row.className = 'perform-pulse-edit__slot-row'

      const active = isSlotActive(slot)
      const activeBtn = document.createElement('button')
      activeBtn.type = 'button'
      activeBtn.className = 'intent-toggle perform-pulse-slot-active-btn'
      activeBtn.textContent = active ? 'On' : 'Off'
      activeBtn.setAttribute('aria-pressed', active ? 'true' : 'false')
      activeBtn.dataset.slotIdx = String(i)
      if (active) {
        activeBtn.classList.add('intent-toggle--enabled')
      }
      activeBtn.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        const slotIdx = Number(activeBtn.dataset.slotIdx)
        if (!Number.isFinite(slotIdx)) return
        const setup = projectGraph.getPulseSetup(currentGuid)
        const slotRows = Array.isArray(setup?.slots) ? setup.slots : []
        const slotNow = slotRows[slotIdx]
        setSlotActive(slotIdx, !isSlotActive(slotNow))
      })

      const labelBtn = document.createElement('button')
      labelBtn.type = 'button'
      labelBtn.className = 'perform-pulse-edit__slot-label'
      const bucketLabel = resolveBucketLabel(bucketGuid)
      labelBtn.textContent = bucketLabel
        ? `${i + 1}: ${bucketLabel}`
        : `${i + 1}`
      labelBtn.addEventListener('click', () => {
        void pickSlotBucket(i)
      })

      const clearBtn = document.createElement('button')
      clearBtn.type = 'button'
      clearBtn.className =
        'input-assign-inline-icon-btn input-assign-inline-icon-btn--delete perform-pulse-edit__slot-clear'
      clearBtn.textContent = '❌'
      clearBtn.setAttribute('aria-label', `Clear bucket from slot ${i + 1}`)
      clearBtn.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        clearSlotBucket(i)
      })

      row.appendChild(activeBtn)
      row.appendChild(labelBtn)
      row.appendChild(clearBtn)
      slotList.appendChild(row)
    }
    body.appendChild(slotList)
  }

  /**
   * @param {number} slotIdx
   * @param {boolean} active
   */
  function setSlotActive (slotIdx, active) {
    sendPulseControlCommand({
      command: 'setSlotActive',
      setupGuid: currentGuid,
      slotIdx,
      active
    })
  }

  /** @param {number} slotIdx */
  function clearSlotBucket (slotIdx) {
    sendPulseControlCommand({
      command: 'assignSlotBucket',
      setupGuid: currentGuid,
      slotIdx,
      bucketGuid: null
    })
  }

  /** @param {number} slotIdx */
  async function pickSlotBucket (slotIdx) {
    const buckets = [...projectGraph.getPulseBuckets()]
    if (buckets.length === 0) {
      await Modal.warn('No pulse buckets defined yet.')
      return
    }
    const setup = projectGraph.getPulseSetup(currentGuid)
    const slots = Array.isArray(setup?.slots) ? setup.slots : []
    const slot = slots[slotIdx]
    const selectedBucketGuid =
      slot &&
      typeof slot === 'object' &&
      !Array.isArray(slot) &&
      typeof slot.bucket === 'string' &&
      slot.bucket.length > 0
        ? slot.bucket
        : null

    const options = buckets.map(b => {
      const guid = String(b.guid ?? '')
      const name = typeof b.name === 'string' && b.name ? b.name : guid
      const members = bucketMemberChips(b)
      const summary =
        members.length > 0 ? members.map(c => c.text).join(', ') : 'empty'
      return {
        value: guid,
        label: name,
        title: `${name}: ${summary}`
      }
    })

    const choice = await pickChoice('Assign bucket to slot', options, {
      selected: selectedBucketGuid,
      scrollKey: 'pulse.bucket-slot-picker',
      displayRowFn: (row, option, { button }) => {
        row.classList.add('pulse-bucket-pick-row')
        button.classList.add('pulse-bucket-pick-row__btn')
        button.style.justifyContent = 'flex-start'
        button.style.textAlign = 'left'

        const bucket = buckets.find(b => String(b.guid ?? '') === option.value)
        const members = bucket ? bucketMemberChips(bucket) : []

        const chipsEl = document.createElement('div')
        chipsEl.className = 'pulse-bucket-pick-row__chips'
        chipsEl.setAttribute('aria-hidden', 'true')

        if (members.length === 0) {
          const chip = document.createElement('span')
          chip.className = 'pulse-bucket-chip pulse-bucket-chip--empty'
          chip.textContent = 'empty'
          chipsEl.appendChild(chip)
        } else {
          for (const member of members) {
            const chip = document.createElement('span')
            chip.className = `pulse-bucket-chip pulse-bucket-chip--${member.kind}`
            chip.textContent = member.text
            chipsEl.appendChild(chip)
          }
        }

        row.appendChild(chipsEl)
      }
    })
    if (choice === null || choice.length === 0) return
    sendPulseControlCommand({
      command: 'assignSlotBucket',
      setupGuid: currentGuid,
      slotIdx,
      bucketGuid: choice
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

  function syncKnobFromState () {
    if (!currentGuid || !bpmKnob) return
    const setup = projectGraph.getPulseSetup(currentGuid)
    if (!setup) return
    currentBpm = readBpmFromSetup(setup)
    bpmKnob.syncFromExternal()
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

  subscribePulsePlayState(() => {
    if (el.hidden || !currentGuid) return
    syncKnobFromState()
  })

  return { el, open }
}
