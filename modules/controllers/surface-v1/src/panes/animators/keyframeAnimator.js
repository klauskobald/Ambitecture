import { AnimatorViewer } from './AnimatorViewer.js'
import { subscribeBinding } from '../../core/bindingRegistry.js'
import { sendAnimationEdit, sendBindingSet } from '../../core/outboundQueue.js'
import { editText, warn as modalWarn } from '../../core/Modal.js'

/** Per-animation cleanup so reopening the pane drops the prior callback and edit session. */
const activeBindings = new Map()

export class KeyframeAnimatorViewer extends AnimatorViewer {
  getClassName () { return 'keyframeAnimator' }
  getName () { return 'Keyframe' }

  shouldWarnOnClassSwitch (record) {
    const steps = record?.content?.steps
    return Array.isArray(steps) && steps.length > 0
  }

  /**
   * Live keyframe-stepping edit section. The hub-side animator owns the editState shape
   * `{ totalSteps, currentStepIndex, currentStepContent }`; this UI just displays it and
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
        sendBindingSet(bindingKey, { currentStepIndex: Math.min(total - 1, idx + 1) })
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
      removeBtn.className = 'animator-edit-section__nav-btn'
      removeBtn.textContent = 'Remove'
      removeBtn.disabled = total <= 1
      removeBtn.addEventListener('click', () => {
        sendBindingSet(bindingKey, {
          currentStepIndex: idx,
          editAction: 'remove'
        })
      })

      tools.replaceChildren(addBtn, mergeBtn, removeBtn)

      nav.appendChild(prevBtn)
      nav.appendChild(counter)
      nav.appendChild(nextBtn)

      const dump = document.createElement('pre')
      dump.className = 'animator-edit-section__dump'
      dump.textContent = formatStepText(state?.currentStepContent)
      dump.tabIndex = 0
      dump.title = 'Tap to edit step content'
      dump.addEventListener('click', () => {
        void openStepContentEditor(state, bindingKey)
      })

      topLeft.replaceChildren(header, tools)
      top.replaceChildren(topLeft, nav)
      body.appendChild(dump)
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
 * @param {string} bindingKey
 * @param {{ initialStep: unknown, mode: 'add' | 'edit' }} options
 * @returns {Promise<void>}
 */
async function openStepContentEditor (state, bindingKey, options = { initialStep: state?.currentStepContent, mode: 'edit' }) {
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
