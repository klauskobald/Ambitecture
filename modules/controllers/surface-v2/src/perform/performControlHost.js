import { projectGraph, inputActionGuidList } from '../core/projectGraph.js'
import { sendActionTrigger } from '../core/outboundQueue.js'
import {
  ArraySorter,
  DEFAULT_PERFORM_INPUT_SORT_KEY
} from '../core/arraySorter.js'
import { collectPerformButtonInputs } from '../core/performButtonInputs.js'
import { createButtonForInput } from '../core/performButtons/performButtonFactory.js'
import {
  performMomentaryPress,
  performMomentaryRelease
} from '../core/performMomentaryRegistry.js'
import { createSceneAutoResetToggleButton } from './performSceneAutoResetToggle.js'

/**
 * Renders perform button inputs into a mount element (v1 PerformPane control strip).
 */
export class PerformControlHost {
  constructor () {
    /** @type {Map<string, HTMLButtonElement>} */
    this._buttonByGuid = new Map()
    /** @type {Map<number, { guid: string, actionGuids: string[], behavior: string }>} */
    this._activePointers = new Map()
  }

  /**
   * @param {HTMLElement} mount
   */
  render (mount) {
    const activeInputs = this._activeDisplayInputs()
    const activeGuids = new Set()
    let insertedAutoResetToggle = false

    for (const input of activeInputs) {
      if (
        !insertedAutoResetToggle &&
        getActionTargetType(input) === 'scene'
      ) {
        mount.appendChild(createSceneAutoResetToggleButton())
        insertedAutoResetToggle = true
      }
      const guid = String(input.guid ?? '')
      if (!guid) continue
      activeGuids.add(guid)
      const button = this._buttonForInput(guid)

      const performButton = createButtonForInput(guid, input, button)
      performButton.render()

      mount.appendChild(button)
    }

    for (const [guid, button] of this._buttonByGuid) {
      if (activeGuids.has(guid)) continue
      this._releasePointersForButton(button)
      button.remove()
      this._buttonByGuid.delete(guid)
    }
  }

  /** @param {string} guid */
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
    button.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
    })
    this._buttonByGuid.set(guid, button)
    return button
  }

  /**
   * @param {HTMLButtonElement} button
   * @param {PointerEvent} event
   */
  _handlePointerDown (button, event) {
    const input = this._inputForButton(button)
    const actionGuids = input
      ? inputActionGuidList(/** @type {Record<string, unknown>} */ (input))
      : []
    if (!input || actionGuids.length === 0) return

    const behavior = typeof input.type === 'string' ? input.type : 'button'

    if (behavior === 'toggle') {
      event.preventDefault()
      const guid = String(input.guid ?? button.dataset.inputGuid ?? '')
      if (!guid) return
      button.classList.add('perform-input--pressed')

      const performButton = createButtonForInput(guid, input, button)
      const isCurrentlyActive = performButton._isHighlighted()
      const value = isCurrentlyActive ? 'off' : 'on'

      for (const ag of actionGuids) {
        sendActionTrigger(ag, { value })
      }
      return
    }

    if (this._activePointers.has(event.pointerId)) return

    this._activePointers.set(event.pointerId, {
      guid: String(input.guid ?? button.dataset.inputGuid ?? ''),
      actionGuids,
      behavior
    })
    if (button.setPointerCapture) button.setPointerCapture(event.pointerId)

    switch (behavior) {
      case 'momentarySwitch':
        button.classList.add('perform-input--pressed')
        this._pressMomentarySwitch(input, event.pointerId, actionGuids)
        break
      case 'button':
      default:
        button.classList.add('perform-input--pressed')
        for (const ag of actionGuids) {
          sendActionTrigger(ag, { value: 'on' })
        }
        break
    }
  }

  /**
   * @param {HTMLButtonElement} button
   * @param {PointerEvent} event
   */
  _handlePointerRelease (button, event) {
    const input = this._inputForButton(button)
    const behavior = input
      ? typeof input.type === 'string'
        ? input.type
        : 'button'
      : 'button'
    if (behavior === 'toggle') {
      button.classList.remove('perform-input--pressed')
      return
    }
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
    button.classList.remove('perform-input--pressed')
    if (button.hasPointerCapture?.(pointerId))
      button.releasePointerCapture(pointerId)

    switch (active.behavior) {
      case 'momentarySwitch':
        this._releaseMomentarySwitch(active.guid, pointerId, active.actionGuids)
        break
      default:
        break
    }
  }

  /**
   * @param {Record<string, unknown>} input
   * @param {number} pointerId
   * @param {string[]} actionGuids
   */
  _pressMomentarySwitch (input, pointerId, actionGuids) {
    const guid = String(input.guid ?? '')
    if (!guid) return
    const sourceId = `pointer:${pointerId}`
    performMomentaryPress(guid, sourceId, actionGuids)
  }

  /**
   * @param {string} guid
   * @param {number} pointerId
   * @param {string[]} actionGuids
   */
  _releaseMomentarySwitch (guid, pointerId, actionGuids) {
    const sourceId = `pointer:${pointerId}`
    performMomentaryRelease(guid, sourceId, actionGuids)
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

  /** @returns {Record<string, unknown>[]} */
  _activeDisplayInputs () {
    const raw = collectPerformButtonInputs()
    return new ArraySorter(raw, DEFAULT_PERFORM_INPUT_SORT_KEY).getItemsSorted()
  }
}

/**
 * @param {Record<string, unknown>} inputData
 * @returns {string | null}
 */
function getActionTargetType (inputData) {
  const ags = inputActionGuidList(inputData)
  if (ags.length === 0) return null
  const action = projectGraph.getActions().get(ags[0])
  if (!action) return null
  const ex = action.execute
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return null
  return typeof ex.type === 'string' ? ex.type : null
}
