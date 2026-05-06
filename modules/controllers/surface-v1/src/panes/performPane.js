import { performPolicy } from '../viewport/interactionPolicies.js'
import { projectGraph } from '../core/projectGraph.js'
import { sendActionTrigger } from '../core/outboundQueue.js'
import { PerformQuickPanelHud } from '../perform/performQuickPanelHud.js'
import {
  ArraySorter,
  DEFAULT_PERFORM_INPUT_SORT_KEY
} from '../core/arraySorter.js'
import { collectPerformButtonInputs } from '../core/performButtonInputs.js'
import { PerformSubnavShell } from './performSubnavShell.js'

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | undefined}
 */
function recordOrUndefined (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  return /** @type {Record<string, unknown>} */ (value)
}

/**
 * Perform pane — shows the shared simulator viewport with performPolicy active.
 * Only intents with performEnabled=true in the allowances graph can be dragged.
 */
export class PerformPane {
  /**
   * @param {import('../viewport/overlayCanvas.js').OverlayCanvas} overlay
   */
  constructor (overlay) {
    this._overlay = overlay
    this._el = document.createElement('div')
    this._el.className = 'pane perform-pane'
    this._el.hidden = true
    this._subnavShell = new PerformSubnavShell()
    this._el.appendChild(this._subnavShell.element)

    /** @type {Map<string, HTMLButtonElement>} */
    this._buttonByGuid = new Map()
    /** @type {Map<number, { guid: string, actionGuid: string, behavior: string }>} */
    this._activePointers = new Map()
    /** @type {Map<string, Set<number>>} */
    this._momentaryPointersByGuid = new Map()
    /** @type {(() => void) | null} */
    this._unsubscribe = null
    /** @type {PerformQuickPanelHud | null} */
    this._quickHud = null
  }

  /** @param {HTMLElement} container */
  mount (container) {
    container.appendChild(this._el)
  }

  activate () {
    this._overlay.setPolicy(performPolicy)
    this._overlay.resize()
    try {
      this._quickHud = new PerformQuickPanelHud(this._overlay)
      this._overlay.setCoactivityCallback(() => {
        this._quickHud?.markLayoutActivity()
      })
      this._quickHud.start()
    } catch {
      this._quickHud = null
    }
    this._render()
    this._subnavShell.syncSubpaneFromState()
    this._el.hidden = false
    this._unsubscribe = projectGraph.subscribe(() => this._render())
  }

  deactivate () {
    this._el.hidden = true
    this._subnavShell.closeMobileNav()
    this._unsubscribe?.()
    this._unsubscribe = null
    this._overlay.setCoactivityCallback(null)
    if (this._quickHud) {
      this._quickHud.stop()
      this._quickHud = null
    }
  }

  _render () {
    const activeInputs = this._activeDisplayInputs()
    const activeGuids = new Set()

    const activeSceneName = projectGraph.getActiveSceneName()
    const activeSceneGuid = activeSceneName
      ? projectGraph.getSceneGuid(activeSceneName)
      : null
    const scenePerformInput =
      activeSceneGuid && projectGraph.getSceneButtonInput(activeSceneGuid)
    const highlightedInputGuid = scenePerformInput
      ? String(scenePerformInput.guid ?? '')
      : ''

    for (const input of activeInputs) {
      const guid = String(input.guid ?? '')
      if (!guid) continue
      activeGuids.add(guid)
      const button = this._buttonForInput(guid)
      button.textContent = String(input.name ?? 'Button')
      button.dataset.actionGuid =
        typeof input.action === 'string' ? input.action : ''
      button.dataset.inputGuid = guid
      button.dataset.behavior =
        typeof input.type === 'string' ? input.type : 'button'
      button.classList.toggle(
        'btn--active',
        highlightedInputGuid !== '' && guid === highlightedInputGuid
      )
      this._subnavShell.controlsMount.appendChild(button)
    }

    for (const [guid, button] of this._buttonByGuid) {
      if (activeGuids.has(guid)) continue
      this._releasePointersForButton(button)
      button.remove()
      this._buttonByGuid.delete(guid)
    }
  }

  /**
   * @param {string} guid
   * @returns {HTMLButtonElement}
   */
  _buttonForInput (guid) {
    const existing = this._buttonByGuid.get(guid)
    if (existing) return existing
    const button = document.createElement('button')
    button.className = 'btn perform-input perform-input--button'
    button.addEventListener('pointerdown', event =>
      this._handlePointerDown(button, event)
    )
    button.addEventListener('pointerup', event =>
      this._handlePointerRelease(button, event)
    )
    button.addEventListener('pointercancel', event =>
      this._handlePointerRelease(button, event)
    )
    button.addEventListener('lostpointercapture', event =>
      this._handlePointerRelease(button, event)
    )
    this._buttonByGuid.set(guid, button)
    return button
  }

  /**
   * @param {HTMLButtonElement} button
   * @param {PointerEvent} event
   */
  _handlePointerDown (button, event) {
    const input = this._inputForButton(button)
    const actionGuid = typeof input?.action === 'string' ? input.action : ''
    if (!input || !actionGuid || this._activePointers.has(event.pointerId))
      return

    const behavior = typeof input.type === 'string' ? input.type : 'button'
    this._activePointers.set(event.pointerId, {
      guid: String(input.guid ?? button.dataset.inputGuid ?? ''),
      actionGuid,
      behavior
    })
    if (button.setPointerCapture) button.setPointerCapture(event.pointerId)

    switch (behavior) {
      case 'momentarySwitch':
        this._pressMomentarySwitch(input, event.pointerId, actionGuid)
        break
      case 'button':
      default:
        sendActionTrigger(actionGuid, this._inputArgs(input, 'args'))
        break
    }
  }

  /**
   * @param {HTMLButtonElement} button
   * @param {PointerEvent} event
   */
  _handlePointerRelease (button, event) {
    this._releasePointer(button, event.pointerId)
  }

  /**
   * @param {HTMLButtonElement} button
   * @param {number} pointerId
   */
  _releasePointer (button, pointerId) {
    const active = this._activePointers.get(pointerId)
    if (!active) return
    this._activePointers.delete(pointerId)
    if (button.hasPointerCapture?.(pointerId))
      button.releasePointerCapture(pointerId)

    switch (active.behavior) {
      case 'momentarySwitch':
        this._releaseMomentarySwitch(active.guid, pointerId, active.actionGuid)
        break
      default:
        break
    }
  }

  /**
   * @param {Record<string, unknown>} input
   * @param {number} pointerId
   * @param {string} actionGuid
   */
  _pressMomentarySwitch (input, pointerId, actionGuid) {
    const guid = String(input.guid ?? '')
    if (!guid) return
    const pointers = this._momentaryPointersByGuid.get(guid) ?? new Set()
    const wasInactive = pointers.size === 0
    pointers.add(pointerId)
    this._momentaryPointersByGuid.set(guid, pointers)
    if (wasInactive)
      sendActionTrigger(actionGuid, this._inputArgs(input, 'argsOn'))
  }

  /**
   * @param {string} guid
   * @param {number} pointerId
   * @param {string} actionGuid
   */
  _releaseMomentarySwitch (guid, pointerId, actionGuid) {
    const pointers = this._momentaryPointersByGuid.get(guid)
    if (!pointers) return
    pointers.delete(pointerId)
    if (pointers.size > 0) return
    this._momentaryPointersByGuid.delete(guid)
    const input = projectGraph.getInputs().get(guid)
    if (input) sendActionTrigger(actionGuid, this._inputArgs(input, 'argsOff'))
  }

  /** @param {HTMLButtonElement} button */
  _releasePointersForButton (button) {
    const guid = button.dataset.inputGuid ?? ''
    for (const [pointerId, active] of [...this._activePointers.entries()]) {
      if (active.guid !== guid) continue
      this._releasePointer(button, pointerId)
    }
  }

  /**
   * @param {HTMLButtonElement} button
   * @returns {Record<string, unknown> | undefined}
   */
  _inputForButton (button) {
    const guid = button.dataset.inputGuid ?? ''
    return guid ? projectGraph.getInputs().get(guid) : undefined
  }

  /**
   * @param {Record<string, unknown>} input
   * @param {string} key
   * @returns {Record<string, unknown> | undefined}
   */
  _inputArgs (input, key) {
    const params = recordOrUndefined(input.params)
    return recordOrUndefined(params?.[key])
  }

  /** @returns {Record<string, unknown>[]} */
  _activeDisplayInputs () {
    const raw = collectPerformButtonInputs()
    return new ArraySorter(raw, DEFAULT_PERFORM_INPUT_SORT_KEY).getItemsSorted()
  }
}
