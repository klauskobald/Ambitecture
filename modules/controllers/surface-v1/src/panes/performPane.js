import { performPolicy } from '../viewport/interactionPolicies.js'
import { projectGraph, inputActionGuidList } from '../core/projectGraph.js'
import { sendActionTrigger } from '../core/outboundQueue.js'
import { PerformQuickPanelHud } from '../perform/performQuickPanelHud.js'
import {
  ArraySorter,
  DEFAULT_PERFORM_INPUT_SORT_KEY
} from '../core/arraySorter.js'
import {
  collectPerformButtonInputs,
  isPerformInputSceneHighlighted,
  normalizeInputKeyChar
} from '../core/performButtonInputs.js'
import {
  performMomentaryPress,
  performMomentaryRelease
} from '../core/performMomentaryRegistry.js'
import {
  clearPerformToggleState,
  getPerformToggleOn,
  syncPerformToggleChrome,
  togglePerformToggleAndGetValue
} from '../core/performToggleLocalState.js'
import { PerformSubnavShell } from './performSubnavShell.js'

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
    this._overlay.setSingleTapIntentCallback(guid => {
      const id = this._subnavShell.activeSubpane
      if (id !== 'animate' && !this._subnavShell.isPluginSubpane(id)) return
      this._subnavShell.toggleIntentFilter(guid)
    })
    this._render()
    this._subnavShell.syncSubpaneFromState()
    this._el.hidden = false
    // Buttons re-render on input/action/scene changes; intent runtime values do not affect them.
    this._unsubscribe = projectGraph.subscribe(
      ['inputs', 'actions', 'scenes', 'controller', 'discovery'],
      () => {
        this._render()
        this._subnavShell.refreshPerformPlugins()
      }
    )
    this._subnavShell.refreshPerformPlugins()
  }

  deactivate () {
    this._el.hidden = true
    this._subnavShell.closeMobileNav()
    this._unsubscribe?.()
    this._unsubscribe = null
    this._overlay.setCoactivityCallback(null)
    this._overlay.setSingleTapIntentCallback(null)
    if (this._quickHud) {
      this._quickHud.stop()
      this._quickHud = null
    }
  }

  _render () {
    const activeInputs = this._activeDisplayInputs()
    const activeGuids = new Set()

    const mount = this._subnavShell.controlsMount

    const actions = projectGraph.getActions()

    for (const input of activeInputs) {
      const guid = String(input.guid ?? '')
      if (!guid) continue
      activeGuids.add(guid)
      const button = this._buttonForInput(guid)

      const { labelEl, badgeEl, keyHintEl } =
        this._ensurePerformButtonChrome(button)
      const newText = String(input.name ?? 'Button')
      if (labelEl.textContent !== newText) labelEl.textContent = newText

      const keyLabel = normalizeInputKeyChar(input.keyChar)
      if (keyHintEl) {
        keyHintEl.textContent = keyLabel
        keyHintEl.hidden = !keyLabel
      }
      button.classList.toggle('perform-input--has-keyhint', Boolean(keyLabel))

      const ags = inputActionGuidList(
        /** @type {Record<string, unknown>} */ (input)
      )
      const newAction = ags[0] ?? ''
      if (button.dataset.actionGuid !== newAction)
        button.dataset.actionGuid = newAction
      if (button.dataset.actionGuids !== ags.join(','))
        button.dataset.actionGuids = ags.join(',')

      if (button.dataset.inputGuid !== guid) button.dataset.inputGuid = guid

      const prevBehavior = button.dataset.behavior ?? ''
      const newBehavior = typeof input.type === 'string' ? input.type : 'button'
      if (prevBehavior === 'toggle' && newBehavior !== 'toggle') {
        clearPerformToggleState(guid)
      }
      if (button.dataset.behavior !== newBehavior)
        button.dataset.behavior = newBehavior

      const unassigned = ags.length === 0 || !ags.every(ag => actions.has(ag))
      button.classList.toggle('perform-input--unassigned', unassigned)
      if (badgeEl) badgeEl.hidden = !unassigned

      const sceneHighlighted = isPerformInputSceneHighlighted(guid)
      const toggleLatched =
        newBehavior === 'toggle' && getPerformToggleOn(guid)
      button.classList.toggle('btn--active', sceneHighlighted || toggleLatched)

      const isToggle = newBehavior === 'toggle'
      if (isToggle) {
        button.setAttribute('role', 'switch')
        button.setAttribute('aria-pressed', toggleLatched ? 'true' : 'false')
      } else {
        button.removeAttribute('role')
        button.removeAttribute('aria-pressed')
      }

      // Always append in sorted order: appendChild moves an existing child to the end,
      // so DOM order tracks _sortIdx after reorder (not only on first mount).
      mount.appendChild(button)
    }

    for (const [guid, button] of this._buttonByGuid) {
      if (activeGuids.has(guid)) continue
      clearPerformToggleState(guid)
      this._releasePointersForButton(button)
      button.remove()
      this._buttonByGuid.delete(guid)
    }
  }

  /**
   * @param {HTMLButtonElement} button
   * @returns {{
   *   labelEl: HTMLSpanElement,
   *   badgeEl: HTMLSpanElement | null,
   *   keyHintEl: HTMLSpanElement | null
   * }}
   */
  _ensurePerformButtonChrome (button) {
    let labelEl = button.querySelector('.perform-input__label')
    let badgeEl = button.querySelector('.perform-input__badge--unassigned')
    let keyHintEl = button.querySelector('.perform-input__keyhint')
    if (!labelEl || !badgeEl || !keyHintEl) {
      button.replaceChildren()
      labelEl = document.createElement('span')
      labelEl.className = 'perform-input__label'
      keyHintEl = document.createElement('span')
      keyHintEl.className = 'perform-input__keyhint'
      keyHintEl.hidden = true
      badgeEl = document.createElement('span')
      badgeEl.className =
        'perform-input__badge perform-input__badge--unassigned'
      badgeEl.textContent = 'unassigned'
      badgeEl.hidden = true
      button.appendChild(labelEl)
      button.appendChild(keyHintEl)
      button.appendChild(badgeEl)
    }
    return {
      labelEl: /** @type {HTMLSpanElement} */ (labelEl),
      badgeEl: /** @type {HTMLSpanElement | null} */ (badgeEl),
      keyHintEl: /** @type {HTMLSpanElement | null} */ (keyHintEl)
    }
  }

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
    button.addEventListener('click', event =>
      this._handlePerformInputClick(button, event)
    )
    this._buttonByGuid.set(guid, button)
    return button
  }

  /**
   * @param {HTMLButtonElement} button
   * @param {Event} event
   */
  _handlePerformInputClick (button, event) {
    const input = this._inputForButton(button)
    const actionGuids = input
      ? inputActionGuidList(/** @type {Record<string, unknown>} */ (input))
      : []
    if (!input || actionGuids.length === 0) return

    const behavior = typeof input.type === 'string' ? input.type : 'button'
    if (behavior !== 'toggle') return

    event.preventDefault()
    const guid = String(input.guid ?? button.dataset.inputGuid ?? '')
    if (!guid) return

    const value = togglePerformToggleAndGetValue(guid)
    for (const ag of actionGuids) {
      sendActionTrigger(ag, { value })
    }
    syncPerformToggleChrome(guid)
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
    if (
      !input ||
      actionGuids.length === 0 ||
      this._activePointers.has(event.pointerId)
    )
      return

    const behavior = typeof input.type === 'string' ? input.type : 'button'
    if (behavior === 'toggle') return

    this._activePointers.set(event.pointerId, {
      guid: String(input.guid ?? button.dataset.inputGuid ?? ''),
      actionGuids,
      behavior
    })
    if (button.setPointerCapture) button.setPointerCapture(event.pointerId)

    switch (behavior) {
      case 'momentarySwitch':
        this._pressMomentarySwitch(input, event.pointerId, actionGuids)
        break
      case 'button':
      default:
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
    performMomentaryPress(guid, `pointer:${pointerId}`, actionGuids)
  }

  /**
   * @param {string} guid
   * @param {number} pointerId
   * @param {string[]} actionGuids
   */
  _releaseMomentarySwitch (guid, pointerId, actionGuids) {
    performMomentaryRelease(guid, `pointer:${pointerId}`, actionGuids)
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
