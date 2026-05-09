import { projectGraph } from './projectGraph.js'
import {
  collectPerformButtonInputs,
  normalizeInputKeyChar
} from './performButtonInputs.js'
import {
  getPerformInputArgs,
  performMomentaryPress,
  performMomentaryRelease
} from './performMomentaryRegistry.js'
import {
  cancelPerformInputKeyboardPulse,
  pulsePerformInputKeyboard,
  setPerformInputKeyboardActive
} from './performKeyboardVisual.js'
import { sendActionTrigger } from './outboundQueue.js'

/**
 * @param {EventTarget | null} el
 * @returns {boolean}
 */
function isTypingContext (el) {
  if (!el || !(el instanceof Element)) return false
  if (el.closest('[contenteditable="true"]')) return true
  if (el.closest('textarea')) return true
  if (el.closest('select')) return true
  const inp = el.closest('input')
  if (inp instanceof HTMLInputElement) {
    const type = inp.type.toLowerCase()
    if (
      type === 'button' ||
      type === 'submit' ||
      type === 'reset' ||
      type === 'checkbox' ||
      type === 'radio' ||
      type === 'range' ||
      type === 'file' ||
      type === 'color' ||
      type === 'hidden'
    ) {
      return false
    }
    return true
  }
  return false
}

/**
 * Singleton: binds `input.keyChar` (case-sensitive) to perform triggers.
 * `momentarySwitch`: keydown/keyup via {@link performMomentaryPress} / {@link performMomentaryRelease}.
 * Other types: keydown only (ignores `repeat`).
 */
class KeyboardManager {
  constructor () {
    /** @type {Map<string, string>} exact keyChar -> input guid */
    this._bindings = new Map()
    /** @type {Set<string>} */
    this._warnedDuplicateKeys = new Set()
    /** @type {(() => void) | null} */
    this._unsubscribe = null
    /** @type {boolean} */
    this._started = false
    this._onKeyDown = this._onKeyDown.bind(this)
    this._onKeyUp = this._onKeyUp.bind(this)
  }

  start () {
    if (this._started) return
    this._started = true
    this.syncBindings()
    this._unsubscribe = projectGraph.subscribe(['inputs', 'actions'], () =>
      this.syncBindings()
    )
    window.addEventListener('keydown', this._onKeyDown, true)
    window.addEventListener('keyup', this._onKeyUp, true)
  }

  stop () {
    if (!this._started) return
    this._started = false
    this._unsubscribe?.()
    this._unsubscribe = null
    window.removeEventListener('keydown', this._onKeyDown, true)
    window.removeEventListener('keyup', this._onKeyUp, true)
  }

  syncBindings () {
    this._bindings.clear()
    const actions = projectGraph.getActions()
    const candidates = collectPerformButtonInputs()

    for (const input of candidates) {
      const guid = typeof input.guid === 'string' ? input.guid : ''
      if (!guid) continue
      const actionGuid = typeof input.action === 'string' ? input.action : ''
      if (!actionGuid || !actions.has(actionGuid)) continue

      const keyChar = normalizeInputKeyChar(input.keyChar)
      if (!keyChar) continue

      const prev = this._bindings.get(keyChar)
      if (prev !== undefined && prev !== guid) {
        if (!this._warnedDuplicateKeys.has(keyChar)) {
          this._warnedDuplicateKeys.add(keyChar)
          console.warn(
            `[KeyboardManager] duplicate keyChar "${keyChar}" — last input wins (${guid})`
          )
        }
      }
      this._bindings.set(keyChar, guid)
    }
  }

  /**
   * @param {KeyboardEvent} event
   */
  _onKeyDown (event) {
    if (event.defaultPrevented) return
    if (isTypingContext(event.target)) return

    const keyChar = event.key
    const inputGuid = this._bindings.get(keyChar)
    if (!inputGuid) return

    const input = projectGraph.getInputs().get(inputGuid)
    if (!input) return
    const actionGuid = typeof input.action === 'string' ? input.action : ''
    if (!actionGuid || !projectGraph.getActions().has(actionGuid)) return

    const behavior =
      typeof input.type === 'string' && input.type.length > 0
        ? input.type
        : 'button'

    if (behavior === 'momentarySwitch') {
      if (event.repeat) return
      event.preventDefault()
      cancelPerformInputKeyboardPulse(inputGuid)
      setPerformInputKeyboardActive(inputGuid, true)
      performMomentaryPress(
        inputGuid,
        `kbd:${keyChar}`,
        actionGuid,
        /** @type {Record<string, unknown>} */ (input)
      )
      return
    }

    if (event.repeat) return
    event.preventDefault()
    pulsePerformInputKeyboard(inputGuid)
    sendActionTrigger(actionGuid, getPerformInputArgs(input, 'args'))
  }

  /**
   * @param {KeyboardEvent} event
   */
  _onKeyUp (event) {
    if (isTypingContext(event.target)) return

    const keyChar = event.key
    const inputGuid = this._bindings.get(keyChar)
    if (!inputGuid) return

    const input = projectGraph.getInputs().get(inputGuid)
    if (!input) return
    const behavior =
      typeof input.type === 'string' && input.type.length > 0
        ? input.type
        : 'button'
    if (behavior !== 'momentarySwitch') return

    const actionGuid = typeof input.action === 'string' ? input.action : ''
    if (!actionGuid) return

    performMomentaryRelease(inputGuid, `kbd:${keyChar}`, actionGuid)
    setPerformInputKeyboardActive(inputGuid, false)
  }
}

export const keyboardManager = new KeyboardManager()
