import { projectGraph } from '../core/projectGraph.js'
import {
  confirm as modalConfirm,
  openModalCard,
  pickChoice,
  prompt as modalPrompt
} from '../core/Modal.js'
import { sendActionInputCommand } from '../core/outboundQueue.js'
import {
  getDisplayTypes,
  getInputTypes,
  resolveDefaultPerformTypes
} from '../core/systemCapabilities.js'

export class InputAssignManager {
  /**
   * @param {{ context: { type: string, guid: string }, labelDefault?: string }} opts
   */
  constructor (opts) {
    const ctx = opts.context
    this._contextType = String(ctx?.type ?? '')
    this._contextGuid = String(ctx?.guid ?? '')
    this._labelDefault = String(opts.labelDefault ?? this._contextGuid)
    /** @type {HTMLButtonElement | null} */
    this._invokeButton = null
  }

  /** @returns {HTMLButtonElement} */
  getInvokeButton () {
    if (this._invokeButton) return this._invokeButton
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'btn prop-row__toggle input-assign__invoke'
    btn.addEventListener('click', () => {
      void this.showControl()
    })
    this._invokeButton = btn
    this._refreshInvokeButton()
    return btn
  }

  refresh () {
    this._refreshInvokeButton()
  }

  /**
   * Inline assign row (target-agnostic): fixed "Input" toggle + assigned input name in grey when set.
   * Unassigned: no placeholder beside the button (name span hidden / empty).
   * @param {{ rowClass?: string, toggleClass?: string, labelClass?: string }} [opts]
   * @returns {HTMLElement}
   */
  getInlinePane (opts = {}) {
    const rowClass = opts.rowClass ?? 'input-assign-inline-row'
    const toggleClass = opts.toggleClass ?? 'intent-toggle'
    const extraLabelClass = opts.labelClass ?? ''

    const row = document.createElement('div')
    const toggle = document.createElement('button')
    toggle.type = 'button'
    const label = document.createElement('span')

    const sync = () => {
      const input = projectGraph.getAssignedInput(
        this._contextType,
        this._contextGuid
      )
      const action = projectGraph.getAssignedAction(
        this._contextType,
        this._contextGuid
      )
      const isActive = Boolean(input?.action && action)
      row.className = isActive
        ? `${rowClass} ${rowClass}--active`.trim()
        : rowClass
      toggle.className = isActive
        ? `${toggleClass} intent-toggle--enabled`.trim()
        : toggleClass
      toggle.textContent = 'Input'
      const rawName = input?.name
      const name =
        typeof rawName === 'string' && rawName.trim().length > 0
          ? rawName.trim()
          : ''
      label.className = ['input-assign-inline-assigned-name', extraLabelClass]
        .filter(Boolean)
        .join(' ')
      label.textContent = name
      label.hidden = !name
    }

    sync()

    toggle.addEventListener('click', () => {
      void this.showControl()
    })

    row.appendChild(toggle)
    row.appendChild(label)
    return row
  }

  async _onInlineLabelClick () {
    const input = projectGraph.getAssignedInput(
      this._contextType,
      this._contextGuid
    )
    const inputGuid = typeof input?.guid === 'string' ? input.guid : ''
    if (!inputGuid) return
    const values = await modalPrompt(
      '',
      [
        {
          label: 'Name',
          key: 'name',
          value: String(input?.name ?? ''),
          placeholder: 'input name'
        }
      ],
      { submit: 'Rename' }
    )
    const nextName = values?.name?.trim()
    if (!nextName || nextName === input?.name) return
    sendActionInputCommand({
      command: 'renameInput',
      inputGuid,
      name: nextName
    })
  }

  async showControl () {
    if (!this._contextType || !this._contextGuid) return
    const inputTypes = getInputTypes()
    const displayTypes = getDisplayTypes()
    if (!inputTypes || !displayTypes) {
      await openModalCard(dismiss => {
        const card = document.createElement('div')
        card.className = 'modal input-assign-modal'
        card.addEventListener('click', e => e.stopPropagation())
        const p = document.createElement('p')
        p.className = 'modal-text'
        p.textContent = 'System capabilities not loaded'
        const sub = document.createElement('p')
        sub.className = 'input-assign-modal__hint'
        sub.textContent =
          'Wait for hub registration or reconnect. Input/display types come from system.yml.'
        const actions = document.createElement('div')
        actions.className = 'modal-actions'
        const ok = document.createElement('button')
        ok.type = 'button'
        ok.className = 'btn btn--primary'
        ok.textContent = 'OK'
        ok.addEventListener('click', () => dismiss(null))
        actions.appendChild(ok)
        card.appendChild(p)
        card.appendChild(sub)
        card.appendChild(actions)
        return card
      })
      return
    }

    const createChoiceValue = '__create_new_input__'
    const removeChoiceValue = '__remove_assignment__'
    const title = this._labelDefault || this._contextGuid
    const assignedInput = projectGraph.getAssignedInput(
      this._contextType,
      this._contextGuid
    )
    const selectedInputGuid =
      typeof assignedInput?.guid === 'string' ? assignedInput.guid : null
    const inputRows = this._collectInputRows()
    /** @type {Array<{ value: string, label: string, disabled?: boolean, title?: string }>} */
    const options = inputRows.map(row => ({
      value: row.guid,
      label: row.name
    }))
    options.push({
      value: createChoiceValue,
      label: 'Create new input'
    })
    options.push({
      value: removeChoiceValue,
      label: 'Remove assignment'
    })
    const selected =
      selectedInputGuid && inputRows.some(row => row.guid === selectedInputGuid)
        ? selectedInputGuid
        : null

    const outcome = await pickChoice(`Input for ${title}`, options, {
      cancel: 'Cancel',
      selected,
      displayRowFn: (row, option, helpers) => {
        if (
          option.value === createChoiceValue ||
          option.value === removeChoiceValue
        )
          return
        row.style.display = 'flex'
        row.style.alignItems = 'center'
        row.style.gap = '8px'
        row.style.flexWrap = 'nowrap'
        helpers.button.style.flex = '1 1 auto'
        helpers.button.style.width = 'auto'
        const editBtn = document.createElement('button')
        editBtn.type = 'button'
        editBtn.className =
          'input-assign-inline-icon-btn input-assign-inline-icon-btn--edit'
        editBtn.style.flex = '0 0 auto'
        editBtn.textContent = '✎'
        editBtn.setAttribute('aria-label', 'Edit')
        editBtn.addEventListener('click', e => {
          e.stopPropagation()
          helpers.dismiss(`__edit__:${option.value}`)
        })
        const deleteBtn = document.createElement('button')
        deleteBtn.type = 'button'
        deleteBtn.className =
          'input-assign-inline-icon-btn input-assign-inline-icon-btn--delete'
        deleteBtn.style.flex = '0 0 auto'
        deleteBtn.textContent = '❌'
        deleteBtn.setAttribute('aria-label', 'Delete')
        deleteBtn.addEventListener('click', e => {
          e.stopPropagation()
          helpers.dismiss(`__delete__:${option.value}`)
        })
        row.appendChild(editBtn)
        row.appendChild(deleteBtn)
      }
    })

    if (outcome === null) return
    if (outcome === createChoiceValue) {
      await this._createInputAndAssign(inputTypes, displayTypes)
      this._refreshInvokeButton()
      return
    }
    if (outcome === removeChoiceValue) {
      sendActionInputCommand({
        command: 'removeInputAssignment',
        targetType: this._contextType,
        targetGuid: this._contextGuid
      })
      this._refreshInvokeButton()
      return
    }
    if (outcome.startsWith('__edit__:')) {
      const inputGuid = outcome.slice('__edit__:'.length)
      await this._renameInputByGuid(inputGuid)
      this._refreshInvokeButton()
      return
    }
    if (outcome.startsWith('__delete__:')) {
      const inputGuid = outcome.slice('__delete__:'.length)
      await this._confirmAndDeleteInput(inputGuid)
      this._refreshInvokeButton()
      return
    }
    sendActionInputCommand({
      command: 'assignExistingInput',
      targetType: this._contextType,
      targetGuid: this._contextGuid,
      inputGuid: outcome
    })
    this._refreshInvokeButton()
  }

  _refreshInvokeButton () {
    if (!this._invokeButton) return
    const isAssigned = Boolean(
      projectGraph.getAssignedInput(this._contextType, this._contextGuid)
    )
    this._invokeButton.textContent = isAssigned ? 'Assigned' : 'Assign'
    this._invokeButton.classList.toggle('intent-toggle--enabled', isAssigned)
    this._invokeButton.setAttribute(
      'aria-pressed',
      isAssigned ? 'true' : 'false'
    )
  }

  /**
   * @param {Record<string, unknown> | null | undefined} input
   * @returns {string}
   */
  _displayClassFromInput (input) {
    const display = input?.display
    if (!display || typeof display !== 'object' || Array.isArray(display))
      return ''
    const record = /** @type {Record<string, unknown>} */ (display)
    return typeof record.type === 'string' ? record.type : ''
  }

  /**
   * @param {unknown} value
   * @returns {Record<string, unknown> | undefined}
   */
  _recordOrUndefined (value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return undefined
    return /** @type {Record<string, unknown>} */ (value)
  }

  /** @returns {Array<{ guid: string, name: string }>} */
  _collectInputRows () {
    const inputs = [...projectGraph.getInputs().values()]
    return inputs
      .map(input => {
        const guid = typeof input?.guid === 'string' ? input.guid : ''
        if (!guid) return null
        const name =
          typeof input?.name === 'string' && input.name.trim().length > 0
            ? input.name.trim()
            : guid
        return { guid, name }
      })
      .filter(
        /** @returns {row is { guid: string, name: string }} */ row =>
          row !== null
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * @param {Array<{ class: string }>} inputTypes
   * @param {Array<{ class: string }>} displayTypes
   */
  async _createInputAndAssign (inputTypes, displayTypes) {
    const values = await modalPrompt(
      '',
      [
        {
          label: 'Name',
          key: 'name',
          value: this._labelDefault,
          placeholder: 'input name'
        }
      ],
      { submit: 'Create' }
    )
    const name = values?.name?.trim()
    if (!name) return
    const defaults = resolveDefaultPerformTypes()
    const type = defaults?.type ?? inputTypes[0]?.class ?? 'button'
    const displayType =
      defaults?.displayType ?? displayTypes[0]?.class ?? 'button'
    sendActionInputCommand({
      command: 'ensureInputAssignment',
      targetType: this._contextType,
      targetGuid: this._contextGuid,
      input: { name, type, displayType }
    })
  }

  /** @param {string} inputGuid */
  async _renameInputByGuid (inputGuid) {
    const input = projectGraph.getInputs().get(inputGuid)
    const values = await modalPrompt(
      '',
      [
        {
          label: 'Name',
          key: 'name',
          value: String(input?.name ?? ''),
          placeholder: 'input name'
        }
      ],
      { submit: 'Rename' }
    )
    const nextName = values?.name?.trim()
    if (!nextName || nextName === input?.name) return
    sendActionInputCommand({
      command: 'renameInput',
      inputGuid,
      name: nextName
    })
  }

  /** @param {string} inputGuid */
  async _confirmAndDeleteInput (inputGuid) {
    const linkedTargetCount = this._countLinkedTargetsForInput(inputGuid)
    const ok = await modalConfirm(
      `Delete this input? It is linked to ${linkedTargetCount} target(s).`,
      { yes: 'Delete', no: 'Cancel' }
    )
    if (!ok) return
    sendActionInputCommand({
      command: 'deleteInput',
      inputGuid,
      expectedLinkedTargetCount: linkedTargetCount
    })
  }

  /**
   * @param {string} inputGuid
   * @returns {number}
   */
  _countLinkedTargetsForInput (inputGuid) {
    const input = projectGraph.getInputs().get(inputGuid)
    if (!input) return 0
    const actionGuid = typeof input.action === 'string' ? input.action : ''
    if (!actionGuid) return 0
    const action = projectGraph.getActions().get(actionGuid)
    if (!action || !Array.isArray(action.execute)) return 0
    const seen = new Set()
    for (const item of action.execute) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const record = /** @type {Record<string, unknown>} */ (item)
      const type = typeof record.type === 'string' ? record.type : ''
      const guid = typeof record.guid === 'string' ? record.guid : ''
      if (!type || !guid) continue
      seen.add(`${type}:${guid}`)
    }
    return seen.size
  }
}
