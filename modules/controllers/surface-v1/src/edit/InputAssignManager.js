import { projectGraph } from '../core/projectGraph.js'
import { confirm, pickChoice, prompt, warn } from '../core/Modal.js'
import { sendActionInputCommand } from '../core/outboundQueue.js'

/**
 * @param {string} value
 * @returns {Record<string, unknown> | undefined}
 */
function parseOptionalJsonObject (value) {
  const raw = value.trim()
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return /** @type {Record<string, unknown>} */ (parsed)
  } catch {
    return undefined
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
    const choice = await pickChoice(
      `${title}: manage input assignment`,
      [
        { value: 'edit', label: isAssigned ? 'Update assignment' : 'Create assignment' },
        { value: 'remove', label: 'Remove assignment', disabled: !isAssigned },
      ],
      { cancel: 'Close' },
    )
    if (!choice) return
    if (choice === 'remove') {
      const ok = await confirm(`Remove input assignment from ${title}?`, { yes: 'Remove', no: 'Cancel' })
      if (!ok) return
      sendActionInputCommand({
        command: 'removeInputAssignment',
        targetType: this._targetType,
        targetGuid: this._targetGuid,
      })
      this._refreshInvokeButton()
      return
    }

    const existingType = typeof assignedInput?.type === 'string' ? assignedInput.type : 'button'
    const selectedType = await pickChoice('Select input type', [
      { value: 'button', label: 'button' },
      { value: 'momentarySwitch', label: 'momentarySwitch' },
    ], { cancel: 'Back' })
    if (!selectedType) return
    const params = this._recordOrUndefined(assignedInput?.params)
    const currentName = typeof assignedInput?.name === 'string'
      ? assignedInput.name
      : (typeof action?.name === 'string' ? action.name : title)
    const currentDisplayType = this._resolveDisplayType(assignedInput)
    const fields = selectedType === 'momentarySwitch'
      ? [
          { label: 'Label', key: 'name', placeholder: 'Button label', value: currentName },
          { label: 'Display type', key: 'displayType', placeholder: 'button', value: currentDisplayType },
          {
            label: 'Args On JSON',
            key: 'argsOnJson',
            placeholder: '{}',
            value: existingType === 'momentarySwitch' ? stringifyOptionalJsonObject(params?.argsOn) : '',
          },
          {
            label: 'Args Off JSON',
            key: 'argsOffJson',
            placeholder: '{}',
            value: existingType === 'momentarySwitch' ? stringifyOptionalJsonObject(params?.argsOff) : '',
          },
        ]
      : [
          { label: 'Label', key: 'name', placeholder: 'Button label', value: currentName },
          { label: 'Display type', key: 'displayType', placeholder: 'button', value: currentDisplayType },
          {
            label: 'Args JSON',
            key: 'argsJson',
            placeholder: '{}',
            value: existingType === 'button' ? stringifyOptionalJsonObject(params?.args) : '',
          },
        ]
    const values = await prompt('Assignment configuration', fields, {
      submit: isAssigned ? 'Update' : 'Create',
      cancel: 'Cancel',
    })
    if (!values) return

    const name = values.name?.trim() ?? ''
    const displayType = values.displayType?.trim() || 'button'
    if (!name) {
      warn('Label is required.')
      return
    }

    if (selectedType === 'momentarySwitch') {
      const parsedOn = parseOptionalJsonObject(values.argsOnJson ?? '')
      const parsedOff = parseOptionalJsonObject(values.argsOffJson ?? '')
      const hasInvalidOn = (values.argsOnJson ?? '').trim().length > 0 && parsedOn === undefined
      const hasInvalidOff = (values.argsOffJson ?? '').trim().length > 0 && parsedOff === undefined
      if (hasInvalidOn || hasInvalidOff) {
        warn('Args On/Off must be valid JSON objects.')
        return
      }
      sendActionInputCommand({
        command: 'ensureInputAssignment',
        targetType: this._targetType,
        targetGuid: this._targetGuid,
        input: {
          name,
          type: selectedType,
          displayType,
          ...(parsedOn !== undefined ? { argsOn: parsedOn } : {}),
          ...(parsedOff !== undefined ? { argsOff: parsedOff } : {}),
        },
      })
      this._refreshInvokeButton()
      return
    }

    const parsedArgs = parseOptionalJsonObject(values.argsJson ?? '')
    const hasInvalidArgs = (values.argsJson ?? '').trim().length > 0 && parsedArgs === undefined
    if (hasInvalidArgs) {
      warn('Args must be a valid JSON object.')
      return
    }
    sendActionInputCommand({
      command: 'ensureInputAssignment',
      targetType: this._targetType,
      targetGuid: this._targetGuid,
      input: {
        name,
        type: selectedType,
        displayType,
        ...(parsedArgs !== undefined ? { args: parsedArgs } : {}),
      },
    })
    this._refreshInvokeButton()
  }

  _refreshInvokeButton () {
    if (!this._invokeButton) return
    const isAssigned = Boolean(projectGraph.getAssignedInput(this._targetType, this._targetGuid))
    this._invokeButton.textContent = isAssigned ? 'Assigned' : 'Assign'
    this._invokeButton.classList.toggle('intent-toggle--enabled', isAssigned)
    this._invokeButton.setAttribute('aria-pressed', isAssigned ? 'true' : 'false')
  }

  /**
   * @param {Record<string, unknown> | null | undefined} input
   * @returns {string}
   */
  _resolveDisplayType (input) {
    const display = input?.display
    if (!display || typeof display !== 'object' || Array.isArray(display)) return 'button'
    const record = /** @type {Record<string, unknown>} */ (display)
    return typeof record.type === 'string' && record.type.length > 0 ? record.type : 'button'
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
