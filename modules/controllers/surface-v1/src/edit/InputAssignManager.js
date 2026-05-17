import { projectGraph, inputActionGuidList } from '../core/projectGraph.js'
import {
  confirm as modalConfirm,
  openModalCard,
  prompt as modalPrompt,
  sampleKey
} from '../core/Modal.js'
import { sendActionInputCommand } from '../core/outboundQueue.js'
import {
  getDisplayTypes,
  getInputTypes,
  resolveDefaultPerformTypes
} from '../core/systemCapabilities.js'
import { normalizeInputKeyChar } from '../core/performButtonInputs.js'
import { AssignedActionsEditor } from './actionEdit/AssignedActionsEditor.js'

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
   * Inline assign row (target-agnostic): "Input" toggle, or assigned input name on the toggle when linked.
   * @param {{ rowClass?: string, toggleClass?: string, labelClass?: string }} [opts]
   * @returns {HTMLElement}
   */
  getInlinePane (opts = {}) {
    const rowClass = opts.rowClass ?? 'input-assign-inline-row'
    const toggleClass = opts.toggleClass ?? 'intent-toggle'
    const row = document.createElement('div')
    const toggle = document.createElement('button')
    toggle.type = 'button'

    const sync = () => {
      const linkedNames = this._collectLinkedInputDisplayNames()
      const isActive = linkedNames.length > 0
      row.className = isActive
        ? `${rowClass} ${rowClass}--active`.trim()
        : rowClass
      toggle.className = isActive
        ? `${toggleClass} intent-toggle--enabled`.trim()
        : toggleClass
      if (isActive) {
        const fullLabel = linkedNames.join(', ')
        toggle.textContent = this._formatInlineInputLabel(linkedNames)
        toggle.title = `Inputs: ${fullLabel}`
      } else {
        toggle.textContent = 'Input'
        toggle.title = 'Assign input'
      }
    }

    sync()

    toggle.addEventListener('click', () => {
      void this.showControl()
    })

    row.appendChild(toggle)
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

  /**
   * @param {unknown} action
   * @param {string} targetType
   * @param {string} targetGuid
   * @returns {boolean}
   */
  _actionExecuteTargets (action, targetType, targetGuid) {
    const raw =
      action &&
      typeof action === 'object' &&
      !Array.isArray(action)
        ? /** @type {{ execute?: unknown }} */ (action).execute
        : undefined
    const ex =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? /** @type {Record<string, unknown>} */ (raw)
        : null
    if (!ex) return false
    return ex.type === targetType && ex.guid === targetGuid
  }

  /**
   * @param {Record<string, unknown>} input
   * @returns {boolean}
   */
  _inputLinksTarget (input) {
    const actions = projectGraph.getActions()
    for (const ag of inputActionGuidList(input)) {
      const action = actions.get(ag)
      if (this._actionExecuteTargets(action, this._contextType, this._contextGuid)) {
        return true
      }
    }
    return false
  }

  _anyInputLinkedToContext () {
    return this._collectLinkedInputDisplayNames().length > 0
  }

  /**
   * Display names for every input linked to this assign context, sorted.
   * @returns {string[]}
   */
  _collectLinkedInputDisplayNames () {
    const names = []
    for (const input of projectGraph.getInputs().values()) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) continue
      if (!this._inputLinksTarget(/** @type {Record<string, unknown>} */ (input))) {
        continue
      }
      const rawName = input.name
      const name =
        typeof rawName === 'string' && rawName.trim().length > 0
          ? rawName.trim()
          : typeof input.guid === 'string'
            ? input.guid
            : ''
      if (name.length > 0) names.push(name)
    }
    return names.sort((a, b) => a.localeCompare(b))
  }

  /**
   * @param {string[]} names
   * @param {number} [maxLen]
   * @returns {string}
   */
  _formatInlineInputLabel (names, maxLen = 25) {
    if (names.length === 0) return ''
    const joined = names.join(', ')
    if (joined.length <= maxLen) return joined
    if (maxLen <= 1) return joined.slice(0, maxLen)
    return `${joined.slice(0, maxLen - 1)}…`
  }

  /**
   * @param {Set<string>} initialLinked
   * @param {Set<string>} pending
   */
  _applyAssignmentPendingSets (initialLinked, pending) {
    const tt = this._contextType
    const tg = this._contextGuid
    const toUnlink = [...initialLinked].filter(g => !pending.has(g))
    const toLink = [...pending].filter(g => !initialLinked.has(g))
    for (const ig of toUnlink) {
      sendActionInputCommand({
        command: 'unlinkInputFromTarget',
        inputGuid: ig,
        targetType: tt,
        targetGuid: tg
      })
    }
    for (const ig of toLink) {
      sendActionInputCommand({
        command: 'assignExistingInput',
        targetType: tt,
        targetGuid: tg,
        inputGuid: ig
      })
    }
  }

  /**
   * @returns {string} e.g. `Animation Explosion` for assign modal title line
   */
  _assignTargetHeadline () {
    const raw = this._contextType.trim().toLowerCase()
    const name =
      typeof this._labelDefault === 'string' && this._labelDefault.trim().length > 0
        ? this._labelDefault.trim()
        : this._contextGuid
    /** @type {Record<string, string>} */
    const map = {
      animation: 'Animation',
      intent: 'Intent',
      scene: 'Scene',
      sequence: 'Sequence'
    }
    const kind =
      map[raw] ??
      (raw.length > 0
        ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
        : 'Target')
    return `${kind} ${name}`.trim()
  }

  /**
   * Shorthand for input `type` shown in the assign list, e.g. `(toggle)`.
   * @param {string} typeRaw
   * @returns {string}
   */
  _inputBehaviorBracketLabel (typeRaw) {
    const t = String(typeRaw ?? '').trim().toLowerCase()
    if (t === 'momentaryswitch') return 'momentary'
    if (t === 'toggle') return 'toggle'
    if (t === 'button') return 'button'
    return t.length > 0 ? t : 'button'
  }

  /**
   * @param {Array<{ guid: string, name: string }>} inputRows
   * @returns {Promise<{ kind: string, inputGuid?: string } | null>}
   */
  _openAssignInputsModal (inputRows) {
    return openModalCard(dismiss => {
      const card = document.createElement('div')
      card.className =
        'modal input-assign-modal input-assign-modal--assign-picker'
      card.addEventListener('click', e => e.stopPropagation())

      const heading = document.createElement('p')
      heading.className = 'modal-text'
      heading.textContent = `Input for ${this._assignTargetHeadline()}`

      const list = document.createElement('div')
      list.className = 'modal-choice-list'

      /** @type {Set<string>} */
      const initialLinked = new Set()
      for (const row of inputRows) {
        const inputRecord = projectGraph.getInputs().get(row.guid)
        if (
          inputRecord &&
          typeof inputRecord === 'object' &&
          !Array.isArray(inputRecord) &&
          this._inputLinksTarget(/** @type {Record<string, unknown>} */ (inputRecord))
        ) {
          initialLinked.add(row.guid)
        }
      }
      /** @type {Set<string>} */
      const pending = new Set(initialLinked)

      const actionsWrap = projectGraph.getActions()

      /** @param {HTMLElement} rowEl @param {boolean} isOn */
      const paintRow = (rowEl, isOn) => {
        const mainBtn = rowEl.querySelector('.input-assign-toggle-main')
        if (mainBtn instanceof HTMLElement) {
          mainBtn.classList.toggle('modal-choice-list__btn--selected', isOn)
          mainBtn.setAttribute('aria-pressed', isOn ? 'true' : 'false')
        }
      }

      for (const row of inputRows) {
        const wrap = document.createElement('div')
        wrap.className = 'modal-choice-list__row input-assign-toggle-row'
        wrap.style.display = 'flex'
        wrap.style.alignItems = 'center'
        wrap.style.gap = '8px'
        wrap.style.flexWrap = 'nowrap'

        const inputRecord = projectGraph.getInputs().get(row.guid)

        const mainBtn = document.createElement('button')
        mainBtn.type = 'button'
        mainBtn.className =
          'btn modal-choice-list__btn input-assign-toggle-main input-assign-toggle-main--rich'
        mainBtn.style.flex = '1 1 auto'
        mainBtn.style.width = 'auto'
        const labelWrap = document.createElement('span')
        labelWrap.className = 'input-assign-toggle-main__label'
        const namePart = document.createElement('span')
        namePart.className = 'input-assign-toggle-main__name'
        namePart.textContent = row.name
        const parenPart = document.createElement('span')
        parenPart.className = 'input-assign-toggle-main__paren'
        const beh = this._inputBehaviorBracketLabel(
          inputRecord && typeof inputRecord.type === 'string'
            ? inputRecord.type
            : ''
        )
        parenPart.textContent = ` (${beh})`
        labelWrap.appendChild(namePart)
        labelWrap.appendChild(parenPart)
        mainBtn.appendChild(labelWrap)
        mainBtn.addEventListener('click', () => {
          if (pending.has(row.guid)) pending.delete(row.guid)
          else pending.add(row.guid)
          paintRow(wrap, pending.has(row.guid))
        })

        const ags = inputRecord
          ? inputActionGuidList(/** @type {Record<string, unknown>} */ (inputRecord))
          : []
        const unassigned =
          ags.length === 0 || !ags.every(ag => actionsWrap.has(ag))
        const keyLabel = normalizeInputKeyChar(inputRecord?.keyChar)
        if (unassigned || keyLabel) {
          mainBtn.style.position = 'relative'
        }
        if (keyLabel) {
          mainBtn.classList.add('modal-choice-list__btn--has-keyhint')
          const keyHint = document.createElement('span')
          keyHint.className = 'modal-choice-list__keyhint'
          keyHint.textContent = keyLabel
          mainBtn.appendChild(keyHint)
        }
        if (unassigned) {
          mainBtn.classList.add('modal-choice-list__btn--unassigned')
          const badge = document.createElement('span')
          badge.className = 'modal-choice-list__unassigned-badge'
          badge.textContent = 'unassigned'
          mainBtn.appendChild(badge)
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
          dismiss({ kind: 'sampleKey', inputGuid: row.guid })
        })

        const editBtn = document.createElement('button')
        editBtn.type = 'button'
        editBtn.className =
          'input-assign-inline-icon-btn input-assign-inline-icon-btn--edit'
        editBtn.style.flex = '0 0 auto'
        editBtn.textContent = '✎'
        editBtn.setAttribute('aria-label', 'Edit')
        editBtn.addEventListener('click', e => {
          e.stopPropagation()
          dismiss({ kind: 'edit', inputGuid: row.guid })
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
          dismiss({ kind: 'delete', inputGuid: row.guid })
        })

        wrap.appendChild(mainBtn)
        wrap.appendChild(keyShortcutBtn)
        wrap.appendChild(editBtn)
        wrap.appendChild(deleteBtn)
        list.appendChild(wrap)
        paintRow(wrap, pending.has(row.guid))
      }

      const createRow = document.createElement('div')
      createRow.className = 'modal-choice-list__row'
      const createBtn = document.createElement('button')
      createBtn.type = 'button'
      createBtn.className = 'btn modal-choice-list__btn'
      createBtn.textContent = 'Create new input'
      createBtn.addEventListener('click', () => dismiss({ kind: 'create' }))
      createRow.appendChild(createBtn)

      const footer = document.createElement('div')
      footer.className = 'modal-actions'
      const okBtn = document.createElement('button')
      okBtn.type = 'button'
      okBtn.className = 'btn btn--primary'
      okBtn.textContent = 'OK'
      okBtn.addEventListener('click', () => {
        this._applyAssignmentPendingSets(initialLinked, pending)
        dismiss({ kind: 'done' })
      })
      footer.appendChild(okBtn)

      const scrollBody = document.createElement('div')
      scrollBody.className = 'input-assign-modal__assign-scroll'
      scrollBody.appendChild(list)
      scrollBody.appendChild(createRow)

      card.appendChild(heading)
      card.appendChild(scrollBody)
      card.appendChild(footer)
      return card
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

    const inputRows = this._collectInputRows()
    const modalOutcome = await this._openAssignInputsModal(inputRows)
    if (modalOutcome === null) return
    if (modalOutcome.kind === 'done') {
      this._refreshInvokeButton()
      return
    }
    if (modalOutcome.kind === 'create') {
      const createdName = await this._createInputAndAssign(inputTypes, displayTypes)
      if (createdName) {
        await this._waitForInputLinkedToTargetByName(createdName)
      }
      this._refreshInvokeButton()
      await this.showControl()
      return
    }
    if (
      modalOutcome.kind === 'sampleKey' &&
      typeof modalOutcome.inputGuid === 'string'
    ) {
      const inputGuid = modalOutcome.inputGuid
      const captured = await sampleKey('Press Key', 'No Key')
      if (captured !== null) {
        await this._sendSetInputKeyCharAndSyncToGraph(inputGuid, captured)
      }
      await this.showControl()
      return
    }
    if (modalOutcome.kind === 'edit' && typeof modalOutcome.inputGuid === 'string') {
      await this._editInputByGuid(modalOutcome.inputGuid)
      this._refreshInvokeButton()
      await this.showControl()
      return
    }
    if (modalOutcome.kind === 'delete' && typeof modalOutcome.inputGuid === 'string') {
      const deleted = await this._confirmAndDeleteInput(modalOutcome.inputGuid)
      if (deleted) {
        await this._waitForInputRemovedFromGraph(modalOutcome.inputGuid)
      }
      this._refreshInvokeButton()
      await this.showControl()
      return
    }
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
    const isAssigned = this._anyInputLinkedToContext()
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
   * @param {string} inputGuid
   * @returns {Promise<void>}
   */
  async _waitForInputRemovedFromGraph (inputGuid) {
    if (!inputGuid) return
    const matches = () => !projectGraph.getInputs().has(inputGuid)
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
      const unsub = projectGraph.subscribe(['inputs', 'actions'], () => {
        if (matches()) finish()
      })
      const tid = window.setTimeout(finish, 2500)
      queueMicrotask(() => {
        if (matches()) finish()
      })
    })
  }

  /**
   * @param {string} inputName
   * @returns {Promise<void>}
   */
  async _waitForInputLinkedToTargetByName (inputName) {
    const expected = inputName.trim()
    if (!expected) return

    const matches = () => {
      for (const input of projectGraph.getInputs().values()) {
        if (typeof input?.name !== 'string' || input.name.trim() !== expected) continue
        if (
          input &&
          typeof input === 'object' &&
          !Array.isArray(input) &&
          this._inputLinksTarget(/** @type {Record<string, unknown>} */ (input))
        ) {
          return true
        }
      }
      return false
    }

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
      const unsub = projectGraph.subscribe(['inputs', 'actions'], () => {
        if (matches()) finish()
      })
      const tid = window.setTimeout(finish, 2500)
      queueMicrotask(() => {
        if (matches()) finish()
      })
    })
  }

  /**
   * @param {Array<{ class: string }>} inputTypes
   * @param {Array<{ class: string }>} displayTypes
   * @returns {Promise<string | null>} created input name, or null if cancelled
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
    if (!name) return null
    const defaults = resolveDefaultPerformTypes()
    const type = defaults?.type ?? inputTypes[0]?.class ?? 'button'
    const displayType =
      defaults?.displayType ?? displayTypes[0]?.class ?? 'button'
    sendActionInputCommand({
      command: 'createInputAssignment',
      targetType: this._contextType,
      targetGuid: this._contextGuid,
      input: { name, type, displayType }
    })
    return name
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

      const errorEl = document.createElement('p')
      errorEl.className = 'input-assign-modal__error'
      errorEl.hidden = true

      const actionGuidsList = inputActionGuidList(
        /** @type {Record<string, unknown>} */ (input)
      )
      const assignedActionsEditor = new AssignedActionsEditor()
      const assignedActionsBuilt = assignedActionsEditor.build({
        actionGuids: actionGuidsList,
        idPrefix: inputGuid,
        inputTypes,
        intentParamBinding: { getInputTypeClass: () => typeSelect.value }
      })

      typeSelect.addEventListener('change', () => {
        errorEl.hidden = true
        assignedActionsBuilt.setInputTypeClass(typeSelect.value)
      })

      const actions = document.createElement('div')
      actions.className = 'modal-actions'

      const cancelBtn = document.createElement('button')
      cancelBtn.type = 'button'
      cancelBtn.className = 'btn'
      cancelBtn.textContent = 'Cancel'
      cancelBtn.addEventListener('click', () => {
        assignedActionsBuilt.destroy()
        dismiss(null)
      })

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

        sendActionInputCommand({
          command: 'updateInput',
          inputGuid,
          input: {
            name,
            type: typeSelect.value,
            displayType: displaySelect.value
          }
        })
        assignedActionsBuilt.emitActionPatches()
        assignedActionsBuilt.destroy()
        dismiss(true)
      })

      actions.appendChild(cancelBtn)
      actions.appendChild(saveBtn)

      card.appendChild(title)
      card.appendChild(nameLabel)
      card.appendChild(typeLabel)
      card.appendChild(displayLabel)
      card.appendChild(assignedActionsBuilt.root)
      card.appendChild(errorEl)
      card.appendChild(actions)

      requestAnimationFrame(() => nameInput.focus())

      return card
    })
  }

  /**
   * @param {string} inputGuid
   * @returns {Promise<boolean>} whether delete was confirmed and sent
   */
  async _confirmAndDeleteInput (inputGuid) {
    const linkedTargetCount = this._countLinkedTargetsForInput(inputGuid)
    const ok = await modalConfirm(
      `Delete this input? It is linked to ${linkedTargetCount} action(s).`,
      { yes: 'Delete', no: 'Cancel' }
    )
    if (!ok) return false
    sendActionInputCommand({
      command: 'deleteInput',
      inputGuid,
      expectedLinkedTargetCount: linkedTargetCount
    })
    return true
  }

  /**
   * @param {string} inputGuid
   * @returns {number}
   */
  _countLinkedTargetsForInput (inputGuid) {
    const input = projectGraph.getInputs().get(inputGuid)
    if (!input) return 0
    return inputActionGuidList(/** @type {Record<string, unknown>} */ (input)).length
  }
}
