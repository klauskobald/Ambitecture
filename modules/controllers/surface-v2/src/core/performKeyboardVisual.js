/**
 * Highlights perform strip + assign-modal choice buttons when a hotkey fires
 * (same visual language as a tap).
 */

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const pulseTimers = new Map()

/**
 * @param {string} guid
 * @returns {string}
 */
function escapeAttr (guid) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(guid)
  }
  return guid.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * @param {string} inputGuid
 * @param {boolean} active
 */
export function setPerformInputKeyboardActive (inputGuid, active) {
  if (!inputGuid) return
  const g = escapeAttr(inputGuid)
  const nodes = document.querySelectorAll(
    `button.perform-input[data-input-guid="${g}"], button.modal-choice-list__btn[data-input-guid="${g}"]`
  )
  for (const el of nodes) {
    if (!(el instanceof HTMLElement)) continue
    if (el.classList.contains('perform-input')) {
      el.classList.toggle('perform-input--keyboard-active', active)
    }
    if (el.classList.contains('modal-choice-list__btn')) {
      el.classList.toggle('modal-choice-list__btn--keyboard-active', active)
    }
  }
}

/**
 * @param {string} inputGuid
 */
export function cancelPerformInputKeyboardPulse (inputGuid) {
  const t = pulseTimers.get(inputGuid)
  if (t !== undefined) {
    clearTimeout(t)
    pulseTimers.delete(inputGuid)
  }
}

/**
 * Brief highlight for latched (button) inputs — mimics a tap.
 * @param {string} inputGuid
 * @param {number} [ms]
 */
export function pulsePerformInputKeyboard (inputGuid, ms = 130) {
  if (!inputGuid) return
  cancelPerformInputKeyboardPulse(inputGuid)
  setPerformInputKeyboardActive(inputGuid, true)
  const t = window.setTimeout(() => {
    pulseTimers.delete(inputGuid)
    setPerformInputKeyboardActive(inputGuid, false)
  }, ms)
  pulseTimers.set(inputGuid, t)
}
