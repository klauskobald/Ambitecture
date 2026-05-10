import { projectGraph } from '../core/projectGraph.js'
import {
  confirm as modalConfirm,
  openModalCard,
  pickChoice,
  prompt as modalPrompt,
  sampleKey
} from '../core/Modal.js'
import { sendActionInputCommand } from '../core/outboundQueue.js'
import {
  getDisplayTypes,
  getInputTypes,
  resolveDefaultPerformTypes,
  resolveDescriptorsForClass
} from '../core/systemCapabilities.js'
import { getIntentClassForInput } from './inputAssign/intentDescriptorContext.js'
import { IntentParamsSelect } from './components/intentParamsSelect.js'
import { normalizeInputKeyChar } from '../core/performButtonInputs.js'

/** @param {unknown} raw */
function cloneParamSlice (raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return { .../** @type {Record<string, unknown>} */ (raw) }
}

/** @param {Record<string, unknown> | null | undefined} input */
function displayClassFromInputRecord (input) {
  const display = input?.display
  if (!display || typeof display !== 'object' || Array.isArray(display))
    return ''
  return typeof /** @type {Record<string, unknown>} */ (display).type === 'string'
    ? /** @type {Record<string, unknown>} */ (display).type
    : ''
}

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
    await this._editInputByGuid(inputGuid)
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
        helpers.button.dataset.inputGuid = option.value
        const inputRecord = projectGraph.getInputs().get(option.value)
        const actions = projectGraph.getActions()
        const actionGuid =
          typeof inputRecord?.action === 'string' ? inputRecord.action : ''
        const unassigned = !actionGuid || !actions.has(actionGuid)
        const keyLabel = normalizeInputKeyChar(inputRecord?.keyChar)
        if (unassigned || keyLabel) {
          helpers.button.style.position = 'relative'
        }
        if (keyLabel) {
          helpers.button.classList.add('modal-choice-list__btn--has-keyhint')
          const keyHint = document.createElement('span')
          keyHint.className = 'modal-choice-list__keyhint'
          keyHint.textContent = keyLabel
          helpers.button.appendChild(keyHint)
        }
        if (unassigned) {
          helpers.button.classList.add('modal-choice-list__btn--unassigned')
          const badge = document.createElement('span')
          badge.className = 'modal-choice-list__unassigned-badge'
          badge.textContent = 'unassigned'
          helpers.button.appendChild(badge)
        }
        const keyShortcutBtn = document.createElement('button')
        keyShortcutBtn.type = 'button'
        keyShortcutBtn.className =
          'input-assign-inline-icon-btn input-assign-inline-icon-btn--key'
        keyShortcutBtn.style.flex = '0 0 auto'
        keyShortcutBtn.textContent = 'key'
        keyShortcutBtn.setAttribute('aria-label', 'Set keyboard shortcut')
        keyShortcutBtn.addEventListener('click', e => {
          e.stopPropagation()
          helpers.dismiss(`__sampleKey__:${option.value}`)
        })
        row.insertBefore(keyShortcutBtn, helpers.button)
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
    if (typeof outcome === 'string' && outcome.startsWith('__sampleKey__:')) {
      const inputGuid = outcome.slice('__sampleKey__:'.length)
      const captured = await sampleKey('Press Key', 'No Key')
      if (captured !== null) {
        await this._sendSetInputKeyCharAndSyncToGraph(inputGuid, captured)
      }
      await this.showControl()
      return
    }
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
      await this._editInputByGuid(inputGuid)
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

  /**
   * Hub applies `setInputKeyChar` asynchronously (`graph:delta`). Wait until the local
   * `projectGraph` matches so the reopened picker shows the new hint immediately.
   * @param {string} inputGuid
   * @param {string} captured `''` = clear; else `KeyboardEvent.key` from {@link sampleKey}
   * @returns {Promise<void>}
   */
  async _sendSetInputKeyCharAndSyncToGraph (inputGuid, captured) {
    const expected =
      captured === '' ? '' : normalizeInputKeyChar(captured)
    const matches = () =>
      normalizeInputKeyChar(
        projectGraph.getInputs().get(inputGuid)?.keyChar
      ) === expected

    if (matches()) return

    await new Promise(resolve => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        window.clearTimeout(tid)
        unsub()
        resolve()
      }
      const unsub = projectGraph.subscribe(['inputs'], () => {
        if (matches()) finish()
      })
      const tid = window.setTimeout(finish, 2500)

      sendActionInputCommand({
        command: 'setInputKeyChar',
        inputGuid,
        keyChar: expected === '' ? null : expected
      })

      queueMicrotask(() => {
        if (matches()) finish()
      })
    })
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
  async _editInputByGuid (inputGuid) {
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

    const input = projectGraph.getInputs().get(inputGuid)
    if (!input) return

    await openModalCard(dismiss => {
      const card = document.createElement('div')
      card.className = 'modal input-assign-modal'
      card.addEventListener('click', e => e.stopPropagation())

      const title = document.createElement('p')
      title.className = 'modal-text'
      title.textContent = 'Edit input'

      const nameLabel = document.createElement('label')
      nameLabel.className = 'input-assign-modal__label'
      nameLabel.textContent = 'Name'
      const nameInput = document.createElement('input')
      nameInput.type = 'text'
      nameInput.className = 'modal-input'
      nameInput.placeholder = 'input name'
      nameInput.value = String(input?.name ?? '')
      nameLabel.appendChild(nameInput)

      const typeLabel = document.createElement('label')
      typeLabel.className = 'input-assign-modal__label'
      typeLabel.textContent = 'Input type'
      const typeSelect = document.createElement('select')
      typeSelect.className = 'modal-input modal-select-capitalize'
      for (const t of inputTypes) {
        const opt = document.createElement('option')
        opt.value = t.class
        opt.textContent = t.name
        typeSelect.appendChild(opt)
      }
      const curType =
        typeof input.type === 'string' &&
        inputTypes.some(t => t.class === input.type)
          ? input.type
          : inputTypes[0].class
      typeSelect.value = curType
      typeLabel.appendChild(typeSelect)

      const displayLabel = document.createElement('label')
      displayLabel.className = 'input-assign-modal__label'
      displayLabel.textContent = 'Display type'
      const displaySelect = document.createElement('select')
      displaySelect.className = 'modal-input modal-select-capitalize'
      for (const d of displayTypes) {
        const opt = document.createElement('option')
        opt.value = d.class
        opt.textContent = d.name
        displaySelect.appendChild(opt)
      }
      const defaults = resolveDefaultPerformTypes()
      const curDisplayRaw = displayClassFromInputRecord(
        /** @type {Record<string, unknown>} */ (input)
      )
      const curDisplay =
        curDisplayRaw && displayTypes.some(d => d.class === curDisplayRaw)
          ? curDisplayRaw
          : defaults?.displayType ?? displayTypes[0].class
      displaySelect.value = curDisplay
      displayLabel.appendChild(displaySelect)

      const paramHost = document.createElement('div')
      paramHost.className = 'input-assign-modal__param-host'

      const errorEl = document.createElement('p')
      errorEl.className = 'input-assign-modal__error'
      errorEl.hidden = true

      const paramsSnapshot = this._recordOrUndefined(input.params)

      const intentClass = getIntentClassForInput(inputGuid)
      const descriptorsRaw = intentClass
        ? resolveDescriptorsForClass(intentClass)
        : null
      const descriptors = Array.isArray(descriptorsRaw) ? descriptorsRaw : []
      const hasIntentDescriptors = descriptors.length > 0

      /** @type {Record<string, Record<string, unknown>>} */
      let draftBySlot = {}
      /** @type {Array<{ destroy: () => void }>} */
      let ipsBuilt = []

      const rebuildDraftFromSnapshot = typeClass => {
        const def = inputTypes.find(t => t.class === typeClass)
        draftBySlot = {}
        if (!def?.params) return
        for (const pk of Object.keys(def.params)) {
          draftBySlot[pk] = cloneParamSlice(paramsSnapshot?.[pk])
        }
      }

      const destroyIpsBuilt = () => {
        for (const x of ipsBuilt) x.destroy()
        ipsBuilt = []
      }

      const renderParamFields = typeClass => {
        destroyIpsBuilt()
        paramHost.replaceChildren()
        errorEl.hidden = true

        const def = inputTypes.find(t => t.class === typeClass)
        if (!def?.params) return

        const needsJsonSlots = Object.values(def.params).some(k => k === 'jsonString')
        if (needsJsonSlots && !hasIntentDescriptors) {
          return
        }

        for (const [paramKey, kind] of Object.entries(def.params)) {
          if (kind !== 'jsonString') continue

          const lab = document.createElement('label')
          lab.className = 'input-assign-modal__label'
          lab.textContent = paramKey

          if (!draftBySlot[paramKey]) {
            draftBySlot[paramKey] = {}
          }
          const paramsSlice = draftBySlot[paramKey]

          const ips = new IntentParamsSelect(true)
          const built = ips.build({
            id: `${inputGuid}-${paramKey}`,
            params: paramsSlice,
            descriptors,
            onLifecycle: () => {}
          })
          ipsBuilt.push(built)

          const holder = document.createElement('div')
          holder.className = 'intent-params-select__wrap'
          holder.appendChild(built.root)
          lab.appendChild(holder)
          paramHost.appendChild(lab)
        }
      }

      rebuildDraftFromSnapshot(typeSelect.value)
      renderParamFields(typeSelect.value)

      typeSelect.addEventListener('change', () => {
        errorEl.hidden = true
        rebuildDraftFromSnapshot(typeSelect.value)
        renderParamFields(typeSelect.value)
      })

      const actions = document.createElement('div')
      actions.className = 'modal-actions'

      const cancelBtn = document.createElement('button')
      cancelBtn.type = 'button'
      cancelBtn.className = 'btn'
      cancelBtn.textContent = 'Cancel'
      cancelBtn.addEventListener('click', () => dismiss(null))

      const saveBtn = document.createElement('button')
      saveBtn.type = 'button'
      saveBtn.className = 'btn btn--primary'
      saveBtn.textContent = 'Save'
      saveBtn.addEventListener('click', () => {
        errorEl.hidden = true
        const name = nameInput.value.trim()
        if (!name) {
          errorEl.textContent = 'Name is required.'
          errorEl.hidden = false
          return
        }

        /** @type {Record<string, unknown>} */
        const payload = {
          name,
          type: typeSelect.value,
          displayType: displaySelect.value
        }

        const typeClass = typeSelect.value
        const def = inputTypes.find(t => t.class === typeClass)
        const needsJsonSlots =
          !!def?.params &&
          Object.values(def.params).some(k => k === 'jsonString')
        const canEmitParams = hasIntentDescriptors && needsJsonSlots

        if (def?.params && canEmitParams) {
          for (const [paramKey, kind] of Object.entries(def.params)) {
            if (kind !== 'jsonString') continue
            const slice = draftBySlot[paramKey]
            if (slice && typeof slice === 'object') {
              payload[paramKey] = slice
            }
          }
        }

        sendActionInputCommand({
          command: 'updateInput',
          inputGuid,
          input: payload
        })
        dismiss(true)
      })

      actions.appendChild(cancelBtn)
      actions.appendChild(saveBtn)

      card.appendChild(title)
      card.appendChild(nameLabel)
      card.appendChild(typeLabel)
      card.appendChild(displayLabel)
      card.appendChild(paramHost)
      card.appendChild(errorEl)
      card.appendChild(actions)

      requestAnimationFrame(() => nameInput.focus())

      return card
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
