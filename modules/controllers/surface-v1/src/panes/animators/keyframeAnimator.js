import { AnimatorViewer } from './AnimatorViewer.js'
import { subscribeBinding } from '../../core/bindingRegistry.js'
import { sendAnimationEdit, sendBindingSet } from '../../core/outboundQueue.js'
import { editText, warn as modalWarn } from '../../core/Modal.js'
import { notification } from '../../app/notification.js'
import { ScalarRadialKnobSvg } from '../../edit/components/ScalarRadialKnobSvg.js'

/** Per-animation cleanup so reopening the pane drops the prior callback and edit session. */
const activeBindings = new Map()

export class KeyframeAnimatorViewer extends AnimatorViewer {
  getClassName () {
    return 'keyframeAnimator'
  }
  getName () {
    return 'Keyframe'
  }

  shouldWarnOnClassSwitch (record) {
    const steps = record?.content?.steps
    return Array.isArray(steps) && steps.length > 0
  }

  /**
   * Live keyframe-stepping edit section. The hub-side animator owns the editState shape
   * edit state (incl. neighbor times + explicit length from hub); this UI displays it and
   * sends back a clamped step index on prev/next.
   * @param {Record<string, unknown>} record
   * @returns {HTMLElement | null}
   */
  renderEditSection (record) {
    const guid = String(record?.guid ?? '')
    if (!guid) return null

    for (const [otherGuid, cleanup] of activeBindings.entries()) {
      cleanup()
      activeBindings.delete(otherGuid)
    }

    const bindingKey = `${guid}-editState`

    const section = document.createElement('section')
    section.className = 'animator-edit-section'

    const top = document.createElement('div')
    top.className = 'animator-edit-section__top'

    const topLeft = document.createElement('div')
    topLeft.className = 'animator-edit-section__top-left'

    const header = document.createElement('div')
    header.className = 'animator-edit-section__header'
    header.textContent = 'Keyframe edit'

    const tools = document.createElement('div')
    tools.className = 'animator-edit-section__tools'

    const body = document.createElement('div')
    body.className = 'animator-edit-section__body'

    const renderState = state => {
      body.replaceChildren()
      const total = Number(state?.totalSteps) || 0
      const idx = Number.isFinite(state?.currentStepIndex)
        ? Number(state.currentStepIndex)
        : 0
      const nav = document.createElement('div')
      nav.className = 'animator-edit-section__nav'

      const prevBtn = document.createElement('button')
      prevBtn.type = 'button'
      prevBtn.className = 'animator-edit-section__nav-btn'
      prevBtn.textContent = 'Prev'
      prevBtn.disabled = idx <= 0
      prevBtn.addEventListener('click', () => {
        sendBindingSet(bindingKey, { currentStepIndex: Math.max(0, idx - 1) })
      })
      const nextBtn = document.createElement('button')
      nextBtn.type = 'button'
      nextBtn.className = 'animator-edit-section__nav-btn'
      nextBtn.textContent = 'Next'
      nextBtn.disabled = total === 0 || idx >= total - 1
      nextBtn.addEventListener('click', () => {
        sendBindingSet(bindingKey, {
          currentStepIndex: Math.min(total - 1, idx + 1)
        })
      })

      const counter = document.createElement('span')
      counter.className = 'animator-edit-section__counter'
      counter.textContent = total > 0 ? `${idx + 1} of ${total}` : '0 of 0'

      const addBtn = document.createElement('button')
      addBtn.type = 'button'
      addBtn.className = 'animator-edit-section__nav-btn'
      addBtn.textContent = 'Add'
      addBtn.disabled = total <= 0
      addBtn.addEventListener('click', () => {
        const isLastStep = total > 0 && idx >= total - 1
        if (isLastStep) {
          const lengthSeconds = Number(state?.explicitAnimationLengthSec)
          const currentTimeSeconds = Number(state?.currentStepContent?.time)
          const hasValidLength = Number.isFinite(lengthSeconds)
          const hasValidCurrentTime = Number.isFinite(currentTimeSeconds)
          if (
            hasValidLength &&
            hasValidCurrentTime &&
            roundToHundredths(currentTimeSeconds) >=
              roundToHundredths(lengthSeconds)
          ) {
            notification.warn(
              'Cannot add: last step is already at or beyond animation length.',
              `animation-add-denied-${guid}`
            )
            return
          }
        }
        sendBindingSet(bindingKey, {
          currentStepIndex: idx,
          editAction: 'add'
        })
      })

      const mergeBtn = document.createElement('button')
      mergeBtn.type = 'button'
      mergeBtn.className = 'animator-edit-section__nav-btn'
      mergeBtn.textContent = 'Merge'
      mergeBtn.title = 'Apply intent changes into this step (newer values win)'
      mergeBtn.disabled = total <= 0
      mergeBtn.addEventListener('click', () => {
        sendBindingSet(bindingKey, {
          currentStepIndex: idx,
          editAction: 'merge'
        })
      })

      const removeBtn = document.createElement('button')
      removeBtn.type = 'button'
      removeBtn.className =
        'animator-edit-section__nav-btn animator-edit-section__dump-remove'
      removeBtn.textContent = '❌'
      removeBtn.disabled = total <= 1
      removeBtn.addEventListener('click', e => {
        e.stopPropagation()
        sendBindingSet(bindingKey, {
          currentStepIndex: idx,
          editAction: 'remove'
        })
      })

      const timeKnob = makeStepTimeKnob(state, idx, total, bindingKey, guid)
      if (timeKnob) {
        tools.replaceChildren(addBtn, mergeBtn, timeKnob)
      } else {
        tools.replaceChildren(addBtn, mergeBtn)
      }

      nav.appendChild(prevBtn)
      nav.appendChild(counter)
      nav.appendChild(nextBtn)

      const dumpWrap = document.createElement('div')
      dumpWrap.className = 'animator-edit-section__dump-wrap'
      const dump = document.createElement('pre')
      dump.className = 'animator-edit-section__dump'
      dump.textContent = formatStepText(state?.currentStepContent)
      dump.tabIndex = 0
      dump.title = 'Tap to edit step content'
      dump.addEventListener('click', () => {
        void openStepContentEditor(state, bindingKey)
      })
      dumpWrap.appendChild(dump)
      dumpWrap.appendChild(removeBtn)

      topLeft.replaceChildren(header, tools)
      top.replaceChildren(topLeft, nav)
      body.appendChild(dumpWrap)
    }

    const onState = value => {
      if (value == null) {
        body.replaceChildren()
        const note = document.createElement('div')
        note.className = 'animator-edit-section__note'
        note.textContent = 'Waiting for edit state...'
        body.appendChild(note)
        return
      }
      renderState(value)
    }

    const unsub = subscribeBinding(bindingKey, onState)
    sendAnimationEdit(guid, true)
    activeBindings.set(guid, () => {
      unsub()
      sendAnimationEdit(guid, false)
    })

    const note = document.createElement('div')
    note.className = 'animator-edit-section__note'
    note.textContent = 'Waiting for edit state...'
    body.appendChild(note)

    section.appendChild(top)
    section.appendChild(body)
    return section
  }
}

function formatStepText (value) {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * @param {Record<string, unknown>} state
 * @param {number} idx
 * @param {number} total
 * @param {string} bindingKey
 * @param {string} animationGuid
 * @returns {HTMLElement | null}
 */
function makeStepTimeKnob (state, idx, total, bindingKey, animationGuid) {
  if (total <= 2) return null
  if (idx <= 0 || idx >= total - 1) return null

  const prevT = Number(state?.prevStepTimeSec)
  const nextT = Number(state?.nextStepTimeSec)
  if (!Number.isFinite(prevT) || !Number.isFinite(nextT)) return null
  const min = prevT + 0.1
  const max = nextT - 0.1
  if (!(Number.isFinite(min) && Number.isFinite(max) && max > min)) return null

  const currentTimeRaw = Number(state?.currentStepContent?.time)
  const fallback = roundToHundredths((min + max) / 2)
  let currentTime = Number.isFinite(currentTimeRaw) ? currentTimeRaw : fallback
  currentTime = Math.max(min, Math.min(max, currentTime))

  const wrap = document.createElement('div')
  wrap.className = 'perform-animate-speed-wrap'
  const knob = new ScalarRadialKnobSvg({
    descriptor: {
      name: 'Time',
      range: [min, max],
      step: 0.01,
      defaultValue: fallback
    },
    intentGuid: String(animationGuid),
    readValue: () => currentTime,
    onCommit: domain => {
      const rounded = roundToHundredths(domain)
      currentTime = Math.max(min, Math.min(max, rounded))
      sendBindingSet(bindingKey, {
        currentStepIndex: Number(state?.currentStepIndex) || 0,
        currentStepContent: {
          ...(state?.currentStepContent &&
          typeof state.currentStepContent === 'object'
            ? state.currentStepContent
            : {}),
          time: currentTime
        },
        editAction: 'set'
      })
    },
    showInnerSvgTitle: false
  })
  knob.mount(wrap)
  requestAnimationFrame(() => knob.syncFromExternal())
  return wrap
}

/**
 * @param {number} value
 * @returns {number}
 */
function roundToHundredths (value) {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

/**
 * @param {Record<string, unknown>} state
 * @param {string} bindingKey
 * @param {{ initialStep: unknown, mode: 'add' | 'edit' }} options
 * @returns {Promise<void>}
 */
async function openStepContentEditor (
  state,
  bindingKey,
  options = { initialStep: state?.currentStepContent, mode: 'edit' }
) {
  let draft = formatStepText(options.initialStep)
  let reason = ''
  let parsed = null
  while (true) {
    const raw = await editText({
      title: reason ? `Edit keyframe step (${reason})` : 'Edit keyframe step',
      text: draft,
      saveLabel: 'Save',
      cancelLabel: 'Cancel'
    })
    if (raw === null) return
    draft = raw
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      reason = err instanceof Error ? err.message : 'Invalid syntax.'
      await modalWarn(reason)
      continue
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      reason = 'Step must be a JSON object.'
      await modalWarn(reason)
      continue
    }
    if ('args' in parsed) {
      const args = parsed.args
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        reason = 'Step "args" must be a JSON object.'
        await modalWarn(reason)
        continue
      }
    }
    break
  }
  sendBindingSet(bindingKey, {
    currentStepIndex: Number(state?.currentStepIndex) || 0,
    currentStepContent: parsed,
    editAction: options.mode === 'add' ? 'add' : 'set'
  })
}
