import { projectGraph } from '../core/projectGraph.js'
import { openModalCard } from '../core/Modal.js'
import { sendActionInputCommand } from '../core/outboundQueue.js'

/**
 * @param {string} raw
 * @param {string} fieldLabel
 * @returns {{ ok: true, value: Record<string, unknown> | undefined } | { ok: false, message: string }}
 */
function tryParseJsonObjectField (raw, fieldLabel) {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, value: undefined }
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        message: `${fieldLabel} must be one JSON object using { ... }, not an array [...] or a bare string.`,
      }
    }
    return { ok: true, value: /** @type {Record<string, unknown>} */ (parsed) }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'parse error'
    return {
      ok: false,
      message: `${fieldLabel} is not valid JSON (${detail}). Example: {"params.alpha":0.5}`,
    }
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stringifyOptionalJsonObject (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  return JSON.stringify(value)
}

export class InputAssignManager {
  /**
   * @param {{ targetType: string, targetGuid: string, targetName?: string }} opts
   */
  constructor (opts) {
    this._targetType = String(opts.targetType ?? '')
    this._targetGuid = String(opts.targetGuid ?? '')
    this._targetName = String(opts.targetName ?? this._targetGuid)
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

  /** @returns {HTMLElement} */
  getInlinePane () {
    const el = document.createElement('div')
    el.className = 'input-assign__inline'
    return el
  }

  async showControl () {
    if (!this._targetType || !this._targetGuid) return
    const assignedInput = projectGraph.getAssignedInput(this._targetType, this._targetGuid)
    const isAssigned = Boolean(assignedInput)
    const action = isAssigned ? projectGraph.getAssignedAction(this._targetType, this._targetGuid) : null
    const title = this._targetName || this._targetGuid
    const params = this._recordOrUndefined(assignedInput?.params)
    const existingType = typeof assignedInput?.type === 'string' ? assignedInput.type : 'button'
    const currentName = typeof assignedInput?.name === 'string'
      ? assignedInput.name
      : (typeof action?.name === 'string' ? action.name : title)
    const outcome = await openModalCard((dismiss) => {
      const card = document.createElement('div')
      card.className = 'modal input-assign-modal'
      card.addEventListener('click', (e) => e.stopPropagation())

      const heading = document.createElement('p')
      heading.className = 'modal-text'
      heading.textContent = `${title}`

      const sub = document.createElement('p')
      sub.className = 'input-assign-modal__hint'
      sub.textContent = isAssigned
        ? 'Edit the perform control for this target, or remove it. Args are optional JSON objects (runtime patch keys such as params.alpha).'
        : 'Create a perform control: pick input type, set the label, optionally paste a JSON object for args.'

      const errorEl = document.createElement('p')
      errorEl.className = 'input-assign-modal__error'
      errorEl.hidden = true
      errorEl.setAttribute('role', 'alert')

      const fields = document.createElement('div')
      fields.className = 'modal-fields'

      const typeLabel = document.createElement('label')
      typeLabel.className = 'input-assign-modal__label'
      typeLabel.textContent = 'Input type'
      const typeSelect = document.createElement('select')
      typeSelect.className = 'modal-input modal-select-capitalize'
      typeSelect.setAttribute('aria-label', 'Input type')
      for (const opt of [
        { value: 'button', hint: 'tap' },
        { value: 'momentarySwitch', hint: 'hold' },
      ]) {
        const o = document.createElement('option')
        o.value = opt.value
        o.textContent = `${opt.value} (${opt.hint})`
        typeSelect.appendChild(o)
      }
      typeSelect.value = existingType === 'momentarySwitch' ? 'momentarySwitch' : 'button'

      const nameLabel = document.createElement('label')
      nameLabel.className = 'input-assign-modal__label'
      nameLabel.textContent = 'Label (shown on controller)'
      const nameInput = document.createElement('input')
      nameInput.className = 'modal-input'
      nameInput.type = 'text'
      nameInput.placeholder = 'e.g. Flash red'
      nameInput.value = currentName
      nameInput.setAttribute('aria-label', 'Label')

      const displayLabel = document.createElement('label')
      displayLabel.className = 'input-assign-modal__label'
      displayLabel.textContent = 'Display type'
      const displaySelect = document.createElement('select')
      displaySelect.className = 'modal-input modal-select-capitalize'
      displaySelect.setAttribute('aria-label', 'Display type')
      for (const opt of [{ value: 'button', label: 'button' }]) {
        const o = document.createElement('option')
        o.value = opt.value
        o.textContent = opt.label
        displaySelect.appendChild(o)
      }
      displaySelect.value = 'button'

      const argsBlock = document.createElement('div')
      argsBlock.className = 'input-assign-modal__args-button'
      const argsLabel = document.createElement('label')
      argsLabel.className = 'input-assign-modal__label'
      argsLabel.textContent = 'Args (JSON object, optional)'
      const argsTextarea = document.createElement('textarea')
      argsTextarea.className = 'modal-input input-assign-modal__json'
      argsTextarea.placeholder = '{}'
      argsTextarea.value = existingType === 'button' ? stringifyOptionalJsonObject(params?.args) : ''
      argsTextarea.setAttribute('aria-label', 'Args JSON')
      argsBlock.appendChild(argsLabel)
      argsBlock.appendChild(argsTextarea)

      const momentaryBlock = document.createElement('div')
      momentaryBlock.className = 'input-assign-modal__args-momentary'
      momentaryBlock.hidden = true
      const onLabel = document.createElement('label')
      onLabel.className = 'input-assign-modal__label'
      onLabel.textContent = 'Args On (JSON object, optional)'
      const onTextarea = document.createElement('textarea')
      onTextarea.className = 'modal-input input-assign-modal__json'
      onTextarea.placeholder = '{}'
      onTextarea.value = existingType === 'momentarySwitch' ? stringifyOptionalJsonObject(params?.argsOn) : ''
      onTextarea.setAttribute('aria-label', 'Args On JSON')
      const offLabel = document.createElement('label')
      offLabel.className = 'input-assign-modal__label'
      offLabel.textContent = 'Args Off (JSON object, optional)'
      const offTextarea = document.createElement('textarea')
      offTextarea.className = 'modal-input input-assign-modal__json'
      offTextarea.placeholder = '{}'
      offTextarea.value = existingType === 'momentarySwitch' ? stringifyOptionalJsonObject(params?.argsOff) : ''
      offTextarea.setAttribute('aria-label', 'Args Off JSON')
      momentaryBlock.appendChild(onLabel)
      momentaryBlock.appendChild(onTextarea)
      momentaryBlock.appendChild(offLabel)
      momentaryBlock.appendChild(offTextarea)

      fields.appendChild(typeLabel)
      fields.appendChild(typeSelect)
      fields.appendChild(nameLabel)
      fields.appendChild(nameInput)
      fields.appendChild(displayLabel)
      fields.appendChild(displaySelect)
      fields.appendChild(argsBlock)
      fields.appendChild(momentaryBlock)

      const setError = (message) => {
        if (!message) {
          errorEl.textContent = ''
          errorEl.hidden = true
          return
        }
        errorEl.textContent = message
        errorEl.hidden = false
      }

      const syncArgsVisibility = () => {
        const t = typeSelect.value
        argsBlock.hidden = t !== 'button'
        momentaryBlock.hidden = t !== 'momentarySwitch'
        setError('')
      }
      typeSelect.addEventListener('change', syncArgsVisibility)
      syncArgsVisibility()

      const actions = document.createElement('div')
      actions.className = 'modal-actions modal-actions--split'

      const removeBtn = document.createElement('button')
      removeBtn.type = 'button'
      removeBtn.className = 'btn btn--danger'
      removeBtn.textContent = 'Remove'
      removeBtn.title = 'Deletes this controller input and its linked action for this target.'
      removeBtn.disabled = !isAssigned
      removeBtn.addEventListener('click', () => {
        sendActionInputCommand({
          command: 'removeInputAssignment',
          targetType: this._targetType,
          targetGuid: this._targetGuid,
        })
        dismiss('removed')
      })

      const end = document.createElement('div')
      end.className = 'modal-actions__end'

      const cancelBtn = document.createElement('button')
      cancelBtn.type = 'button'
      cancelBtn.className = 'btn'
      cancelBtn.textContent = 'Cancel'
      cancelBtn.addEventListener('click', () => dismiss(null))

      const saveBtn = document.createElement('button')
      saveBtn.type = 'button'
      saveBtn.className = 'btn btn--primary'
      saveBtn.textContent = isAssigned ? 'Save' : 'Create'
      saveBtn.addEventListener('click', () => {
        const name = nameInput.value.trim()
        if (!name) {
          setError('Enter a label: this is the text shown on the perform button.')
          nameInput.focus()
          return
        }
        const displayType = displaySelect.value || 'button'
        const inputType = typeSelect.value

        if (inputType === 'momentarySwitch') {
          const onR = tryParseJsonObjectField(onTextarea.value, 'Args On')
          const offR = tryParseJsonObjectField(offTextarea.value, 'Args Off')
          if (!onR.ok) {
            setError(onR.message)
            onTextarea.focus()
            return
          }
          if (!offR.ok) {
            setError(offR.message)
            offTextarea.focus()
            return
          }
          sendActionInputCommand({
            command: 'ensureInputAssignment',
            targetType: this._targetType,
            targetGuid: this._targetGuid,
            input: {
              name,
              type: 'momentarySwitch',
              displayType,
              ...(onR.value !== undefined ? { argsOn: onR.value } : {}),
              ...(offR.value !== undefined ? { argsOff: offR.value } : {}),
            },
          })
        } else {
          const argsR = tryParseJsonObjectField(argsTextarea.value, 'Args')
          if (!argsR.ok) {
            setError(argsR.message)
            argsTextarea.focus()
            return
          }
          sendActionInputCommand({
            command: 'ensureInputAssignment',
            targetType: this._targetType,
            targetGuid: this._targetGuid,
            input: {
              name,
              type: 'button',
              displayType,
              ...(argsR.value !== undefined ? { args: argsR.value } : {}),
            },
          })
        }
        dismiss('saved')
      })

      end.appendChild(cancelBtn)
      end.appendChild(saveBtn)
      actions.appendChild(removeBtn)
      actions.appendChild(end)

      card.appendChild(heading)
      card.appendChild(sub)
      card.appendChild(errorEl)
      card.appendChild(fields)
      card.appendChild(actions)

      requestAnimationFrame(() => nameInput.focus())

      return card
    })

    if (outcome === 'saved' || outcome === 'removed') {
      this._refreshInvokeButton()
    }
  }

  _refreshInvokeButton () {
    if (!this._invokeButton) return
    const isAssigned = Boolean(projectGraph.getAssignedInput(this._targetType, this._targetGuid))
    this._invokeButton.textContent = isAssigned ? 'Assigned' : 'Assign'
    this._invokeButton.classList.toggle('intent-toggle--enabled', isAssigned)
    this._invokeButton.setAttribute('aria-pressed', isAssigned ? 'true' : 'false')
  }

  /**
   * @param {unknown} value
   * @returns {Record<string, unknown> | undefined}
   */
  _recordOrUndefined (value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    return /** @type {Record<string, unknown>} */ (value)
  }
}
