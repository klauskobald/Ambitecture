import { AnimatorViewer } from './AnimatorViewer.js'
import { subscribeBinding } from '../../core/bindingRegistry.js'
import { sendAnimationEdit, sendBindingSet } from '../../core/outboundQueue.js'

/** Per-animation subscription handle so reopening the pane drops the prior callback. */
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

    const prev = activeBindings.get(guid)
    if (prev) prev()
    activeBindings.delete(guid)

    const bindingKey = `${guid}-editState`

    const section = document.createElement('section')
    section.className = 'animator-edit-section'

    const header = document.createElement('div')
    header.className = 'animator-edit-section__header'
    header.textContent = 'Keyframe edit'

    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'animator-edit-section__toggle'
    toggle.textContent = 'Edit Mode: off'

    const body = document.createElement('div')
    body.className = 'animator-edit-section__body'

    let editing = false

    const renderIdle = () => {
      body.replaceChildren()
      const note = document.createElement('div')
      note.className = 'animator-edit-section__note'
      note.textContent = 'Not in edit mode.'
      body.appendChild(note)
    }

    const renderState = state => {
      body.replaceChildren()
      const total = Number(state?.totalSteps) || 0
      const idx = Number.isFinite(state?.currentStepIndex)
        ? Number(state.currentStepIndex)
        : 0

      const counter = document.createElement('div')
      counter.className = 'animator-edit-section__counter'
      counter.textContent = total > 0 ? `Step ${idx + 1} of ${total}` : 'No steps'

      const dump = document.createElement('pre')
      dump.className = 'animator-edit-section__dump'
      dump.textContent = formatJson(state?.currentStepContent)

      const nav = document.createElement('div')
      nav.className = 'animator-edit-section__nav'
      const prevBtn = document.createElement('button')
      prevBtn.type = 'button'
      prevBtn.className = 'animator-edit-section__nav-btn'
      prevBtn.textContent = '◀ Prev'
      prevBtn.disabled = idx <= 0
      prevBtn.addEventListener('click', () => {
        sendBindingSet(bindingKey, {
          ...state,
          currentStepIndex: Math.max(0, idx - 1)
        })
      })
      const nextBtn = document.createElement('button')
      nextBtn.type = 'button'
      nextBtn.className = 'animator-edit-section__nav-btn'
      nextBtn.textContent = 'Next ▶'
      nextBtn.disabled = total === 0 || idx >= total - 1
      nextBtn.addEventListener('click', () => {
        sendBindingSet(bindingKey, {
          ...state,
          currentStepIndex: Math.min(total - 1, idx + 1)
        })
      })
      nav.appendChild(prevBtn)
      nav.appendChild(nextBtn)

      body.appendChild(counter)
      body.appendChild(dump)
      body.appendChild(nav)
    }

    const onState = value => {
      if (value == null) {
        editing = false
        toggle.textContent = 'Edit Mode: off'
        toggle.classList.remove('animator-edit-section__toggle--on')
        renderIdle()
        return
      }
      editing = true
      toggle.textContent = 'Edit Mode: on'
      toggle.classList.add('animator-edit-section__toggle--on')
      renderState(value)
    }

    toggle.addEventListener('click', () => {
      sendAnimationEdit(guid, !editing)
    })

    const unsub = subscribeBinding(bindingKey, onState)
    activeBindings.set(guid, unsub)
    renderIdle()

    section.appendChild(header)
    section.appendChild(toggle)
    section.appendChild(body)
    return section
  }
}

function formatJson (value) {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
