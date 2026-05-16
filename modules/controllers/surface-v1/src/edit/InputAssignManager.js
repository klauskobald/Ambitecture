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
  resolveAnimationCommandsForClass,
  resolveDefaultPerformTypes,
  resolveDescriptorsForClass
} from '../core/systemCapabilities.js'
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
      const isActive = this._anyInputLinkedToContext()
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
    for (const input of projectGraph.getInputs().values()) {
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
      await this._createInputAndAssign(inputTypes, displayTypes)
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
      await this._confirmAndDeleteInput(modalOutcome.inputGuid)
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

  /**
   * Human-readable line for an action `execute` row (intent / scene / animation / other).
   * @param {Record<string, unknown> | undefined} ex
   * @returns {string}
   */
  _executeTargetSummary (ex) {
    if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return '—'
    const t = typeof ex.type === 'string' ? ex.type : ''
    const guid = typeof ex.guid === 'string' ? ex.guid : ''
    if (!t || !guid) return '—'
    switch (t) {
      case 'intent': {
        const row = projectGraph.getEffectiveIntent(guid)
        const rec =
          row && typeof row === 'object' && !Array.isArray(row)
            ? /** @type {Record<string, unknown>} */ (row)
            : null
        const name = typeof rec?.name === 'string' ? rec.name.trim() : ''
        return `Intent · ${name.length > 0 ? name : guid}`
      }
      case 'scene': {
        const scenes = projectGraph.getScenesData()
        const hit = Array.isArray(scenes)
          ? scenes.find(
              s =>
                s &&
                typeof s === 'object' &&
                !Array.isArray(s) &&
                /** @type {{ guid?: string }} */ (s).guid === guid
            )
          : undefined
        const name =
          hit && typeof hit === 'object' && !Array.isArray(hit) && typeof hit.name === 'string'
            ? hit.name.trim()
            : ''
        return `Scene · ${name.length > 0 ? name : guid}`
      }
      case 'animation': {
        const row = projectGraph.getAnimations().get(guid)
        const rec =
          row && typeof row === 'object' && !Array.isArray(row)
            ? /** @type {Record<string, unknown>} */ (row)
            : null
        const name = typeof rec?.name === 'string' ? rec.name.trim() : ''
        return `Animation · ${name.length > 0 ? name : guid}`
      }
      default:
        return `${t} · ${guid}`
    }
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

      const actionGuidsList = inputActionGuidList(
        /** @type {Record<string, unknown>} */ (input)
      )
      let actionIndex = 0
      let intentActionGuidForParams = ''
      let intentExecuteGuidForParams = ''
      /** @type {Record<string, unknown>} */
      let paramsSnapshot = {}
      /** @type {string | null} */
      let intentClass = null
      /** @type {unknown[]} */
      let descriptors = []
      let hasIntentDescriptors = false

      // ── animation action tracking (parallel to intent, read from systemCapabilities) ─────
      let animationActionGuidForParams = ''
      let animationGuidForParams = ''
      /** @type {string | null} */
      let animationClass = null
      /** @type {{ command: string, hint: string, params: Record<string, unknown> }[] | null} */
      let animationCommands = null
      let hasAnimationCommands = false
      /** @type {{ command?: string, [key: string]: unknown }} */
      let animationParamsDraft = {}

      const recomputeAnimationCommands = () => {
        const g = animationGuidForParams
        if (!g) {
          animationClass = null
          animationCommands = null
          hasAnimationCommands = false
          return
        }
        const anim = projectGraph.getAnimations().get(g)
        const rec =
          anim && typeof anim === 'object' && !Array.isArray(anim)
            ? /** @type {Record<string, unknown>} */ (anim)
            : null
        const cls = typeof rec?.class === 'string' && rec.class.length > 0 ? rec.class : null
        animationClass = cls
        const cmds = animationClass
          ? resolveAnimationCommandsForClass(animationClass)
          : null
        animationCommands = cmds
        hasAnimationCommands = Array.isArray(cmds) && cmds.length > 0
      }

      const recomputeIntentDescriptors = () => {
        const g = intentExecuteGuidForParams
        if (!g) {
          intentClass = null
          descriptors = []
          hasIntentDescriptors = false
          return
        }
        const intent = projectGraph.getEffectiveIntent(g)
        const rec =
          intent && typeof intent === 'object' && !Array.isArray(intent)
            ? /** @type {Record<string, unknown>} */ (intent)
            : null
        const cls = typeof rec?.class === 'string' && rec.class.length > 0 ? rec.class : null
        intentClass = cls
        const descriptorsRaw = intentClass
          ? resolveDescriptorsForClass(intentClass)
          : null
        descriptors = Array.isArray(descriptorsRaw) ? descriptorsRaw : []
        hasIntentDescriptors = descriptors.length > 0
      }

      const assignedTitle = document.createElement('p')
      assignedTitle.className = 'modal-text'
      assignedTitle.textContent = 'Assigned actions'

      const actionNav = document.createElement('div')
      actionNav.className = 'input-assign-modal__action-nav'
      const prevBtn = document.createElement('button')
      prevBtn.type = 'button'
      prevBtn.className = 'btn'
      prevBtn.textContent = 'Prev'
      const summaryEl = document.createElement('p')
      summaryEl.className = 'modal-text input-assign-modal__action-summary'
      summaryEl.textContent = '—'
      const nextBtn = document.createElement('button')
      nextBtn.type = 'button'
      nextBtn.className = 'btn'
      nextBtn.textContent = 'Next'
      const counterEl = document.createElement('span')
      counterEl.className = 'input-assign-modal__action-counter'
      actionNav.appendChild(prevBtn)
      actionNav.appendChild(summaryEl)
      actionNav.appendChild(nextBtn)
      actionNav.appendChild(counterEl)

      const syncActionStepper = () => {
        const n = actionGuidsList.length
        if (n === 0) {
          summaryEl.textContent = 'No actions assigned'
          counterEl.textContent = ''
          prevBtn.disabled = true
          nextBtn.disabled = true
          return
        }
        actionIndex = Math.max(0, Math.min(n - 1, actionIndex))
        const ag = actionGuidsList[actionIndex]
        const act = ag ? projectGraph.getActions().get(ag) : undefined
        const ex =
          act && typeof act.execute === 'object' && !Array.isArray(act.execute)
            ? /** @type {Record<string, unknown>} */ (act.execute)
            : undefined
        summaryEl.textContent = this._executeTargetSummary(ex)
        counterEl.textContent = `${actionIndex + 1} / ${n}`
        prevBtn.disabled = n <= 1 || actionIndex === 0
        nextBtn.disabled = n <= 1 || actionIndex >= n - 1
      }

      const applyActionSelection = () => {
        const n = actionGuidsList.length
        if (n === 0) {
          intentActionGuidForParams = ''
          intentExecuteGuidForParams = ''
          animationActionGuidForParams = ''
          animationGuidForParams = ''
          paramsSnapshot = {}
          animationParamsDraft = {}
          recomputeIntentDescriptors()
          recomputeAnimationCommands()
          syncActionStepper()
          return
        }
        actionIndex = Math.max(0, Math.min(n - 1, actionIndex))
        const ag = actionGuidsList[actionIndex]
        intentActionGuidForParams = ''
        intentExecuteGuidForParams = ''
        animationActionGuidForParams = ''
        animationGuidForParams = ''
        if (ag) {
          const a = projectGraph.getActions().get(ag)
          const ex = a?.execute
          if (
            ex &&
            typeof ex === 'object' &&
            !Array.isArray(ex) &&
            typeof ex.guid === 'string'
          ) {
            if (ex.type === 'intent') {
              intentActionGuidForParams = ag
              intentExecuteGuidForParams = ex.guid
            } else if (ex.type === 'animation') {
              animationActionGuidForParams = ag
              animationGuidForParams = ex.guid
            }
          }
        }
        const activeActionGuid =
          intentActionGuidForParams || animationActionGuidForParams
        const rawStoredParams =
          activeActionGuid.length > 0
            ? (() => {
                const a = projectGraph.getActions().get(activeActionGuid)
                const x = a?.execute
                return x && typeof x === 'object' && !Array.isArray(x) ? x.params : undefined
              })()
            : undefined
        paramsSnapshot = this._recordOrUndefined(rawStoredParams) ?? {}
        animationParamsDraft = animationActionGuidForParams.length > 0
          ? { ...paramsSnapshot }
          : {}
        recomputeIntentDescriptors()
        recomputeAnimationCommands()
        syncActionStepper()
      }

      prevBtn.addEventListener('click', () => {
        if (actionGuidsList.length <= 1) return
        actionIndex = Math.max(0, actionIndex - 1)
        applyActionSelection()
        rebuildDraftFromSnapshot(typeSelect.value)
        renderParamFields(typeSelect.value)
      })
      nextBtn.addEventListener('click', () => {
        if (actionGuidsList.length <= 1) return
        actionIndex = Math.min(actionGuidsList.length - 1, actionIndex + 1)
        applyActionSelection()
        rebuildDraftFromSnapshot(typeSelect.value)
        renderParamFields(typeSelect.value)
      })

      /** @type {Record<string, Record<string, unknown>>} */
      let draftBySlot = {}
      /** @type {Array<{ destroy: () => void }>} */
      let ipsBuilt = []

      const rebuildDraftFromSnapshot = typeClass => {
        const def = inputTypes.find(t => t.class === typeClass)
        draftBySlot = {}
        if (animationActionGuidForParams.length > 0) {
          animationParamsDraft = { ...paramsSnapshot }
          return
        }
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

        // ── animation action params (flat command args, no input-type slots) ───
        if (animationActionGuidForParams.length > 0 && hasAnimationCommands && animationCommands) {
          renderAnimationCommandFields()
          return
        }

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
            id: `${inputGuid}-${paramKey}-${actionIndex}`,
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

      /**
       * Render animation command selector + param fields from
       * `animationCommands` (systemCapabilities). No hardcoded command names.
       */
      const renderAnimationCommandFields = () => {
        if (!animationCommands) return

        const curCmd = typeof animationParamsDraft.command === 'string'
          ? animationParamsDraft.command
          : (animationCommands[0]?.command ?? '')
        const curEntry = animationCommands.find(c => c.command === curCmd)

        // Command selector
        const cmdLabel = document.createElement('label')
        cmdLabel.className = 'input-assign-modal__label'
        cmdLabel.textContent = 'Command'
        const cmdSelect = document.createElement('select')
        cmdSelect.className = 'modal-input modal-select-capitalize'
        for (const c of animationCommands) {
          const opt = document.createElement('option')
          opt.value = c.command
          opt.textContent = c.hint
            ? `${c.command} — ${c.hint}`
            : c.command
          cmdSelect.appendChild(opt)
        }
        cmdSelect.value = curCmd
        cmdLabel.appendChild(cmdSelect)
        paramHost.appendChild(cmdLabel)

        // Per-command param fields
        const paramsHost = document.createElement('div')
        paramsHost.className = 'input-assign-modal__anim-params'

        const renderCmdParams = () => {
          paramsHost.replaceChildren()
          const selected = animationCommands.find(c => c.command === cmdSelect.value)
          const cmdParams = selected?.params
          if (!cmdParams || typeof cmdParams !== 'object' || Array.isArray(cmdParams)) return

          for (const [pk, pd] of Object.entries(cmdParams)) {
            if (!pd || typeof pd !== 'object' || Array.isArray(pd)) continue
            const pdef = /** @type {Record<string, unknown>} */ (pd)
            const ptype = typeof pdef.type === 'string' ? pdef.type : 'string'

            const lab = document.createElement('label')
            lab.className = 'input-assign-modal__label'
            lab.textContent = pk

            if (ptype === 'number') {
              const inp = document.createElement('input')
              inp.type = 'number'
              inp.className = 'modal-input'
              const step = typeof pdef.step === 'number' ? pdef.step : 1
              const defVal = typeof pdef.default === 'number' ? pdef.default : 0
              inp.step = String(step)
              inp.value = String(
                typeof animationParamsDraft[pk] === 'number'
                  ? animationParamsDraft[pk]
                  : defVal
              )
              inp.addEventListener('input', () => {
                const n = Number(inp.value)
                animationParamsDraft[pk] = Number.isFinite(n) ? n : defVal
              })
              lab.appendChild(inp)
            } else {
              const inp = document.createElement('input')
              inp.type = 'text'
              inp.className = 'modal-input'
              const defVal = typeof pdef.default === 'string' ? pdef.default : ''
              inp.value = String(animationParamsDraft[pk] ?? defVal)
              inp.addEventListener('input', () => {
                animationParamsDraft[pk] = inp.value
              })
              lab.appendChild(inp)
            }
            paramsHost.appendChild(lab)
          }
        }

        cmdSelect.addEventListener('change', () => {
          const fresh = { command: cmdSelect.value }
          animationParamsDraft = fresh
          animationParamsDraft.command = cmdSelect.value
          renderCmdParams()
        })

        paramHost.appendChild(paramsHost)
        renderCmdParams()
      }

      applyActionSelection()
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

        const typeClass = typeSelect.value
        const def = inputTypes.find(t => t.class === typeClass)
        const needsJsonSlots =
          !!def?.params &&
          Object.values(def.params).some(k => k === 'jsonString')
        const canEmitParams = hasIntentDescriptors && needsJsonSlots

        sendActionInputCommand({
          command: 'updateInput',
          inputGuid,
          input: {
            name,
            type: typeSelect.value,
            displayType: displaySelect.value
          }
        })
        if (canEmitParams && intentActionGuidForParams.length > 0 && intentExecuteGuidForParams.length > 0 && def?.params) {
          const nextParams = {}
          for (const [paramKey, kind] of Object.entries(def.params)) {
            if (kind !== 'jsonString') continue
            const slice = draftBySlot[paramKey]
            if (slice && typeof slice === 'object') {
              nextParams[paramKey] = slice
            }
          }
          sendActionInputCommand({
            command: 'updateAction',
            actionGuid: intentActionGuidForParams,
            patch: {
              execute: {
                type: 'intent',
                guid: intentExecuteGuidForParams,
                params: nextParams
              }
            }
          })
        }

        if (animationActionGuidForParams.length > 0 && animationGuidForParams.length > 0 && hasAnimationCommands) {
          const cmd = animationParamsDraft.command
          if (typeof cmd === 'string' && cmd.length > 0) {
            const flatParams = { ...animationParamsDraft }
            sendActionInputCommand({
              command: 'updateAction',
              actionGuid: animationActionGuidForParams,
              patch: {
                execute: {
                  type: 'animation',
                  guid: animationGuidForParams,
                  params: flatParams
                }
              }
            })
          }
        }
        dismiss(true)
      })

      actions.appendChild(cancelBtn)
      actions.appendChild(saveBtn)

      card.appendChild(title)
      card.appendChild(nameLabel)
      card.appendChild(typeLabel)
      card.appendChild(displayLabel)
      card.appendChild(assignedTitle)
      card.appendChild(actionNav)
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
      `Delete this input? It is linked to ${linkedTargetCount} action(s).`,
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
    return inputActionGuidList(/** @type {Record<string, unknown>} */ (input)).length
  }
}
