import { projectGraph } from '../core/projectGraph.js'
import { openModalCard } from '../core/Modal.js'
import { sendActionInputCommand } from '../core/outboundQueue.js'
import { getDisplayTypes, getInputTypes } from '../core/systemCapabilities.js'
import { parseParamFromForm, stringifyJsonStringParam } from './inputAssign/paramKindHandlers.js'

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
    const inputTypes = getInputTypes()
    const displayTypes = getDisplayTypes()
    if (!inputTypes || !displayTypes) {
      await openModalCard((dismiss) => {
        const card = document.createElement('div')
        card.className = 'modal input-assign-modal'
        card.addEventListener('click', (e) => e.stopPropagation())
        const p = document.createElement('p')
        p.className = 'modal-text'
        p.textContent = 'System capabilities not loaded'
        const sub = document.createElement('p')
        sub.className = 'input-assign-modal__hint'
        sub.textContent = 'Wait for hub registration or reconnect. Input/display types come from system.yml.'
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

    const assignedInput = projectGraph.getAssignedInput(this._targetType, this._targetGuid)
    const isAssigned = Boolean(assignedInput)
    const action = isAssigned ? projectGraph.getAssignedAction(this._targetType, this._targetGuid) : null
    const title = this._targetName || this._targetGuid
    const params = this._recordOrUndefined(assignedInput?.params)
    const existingType = typeof assignedInput?.type === 'string' ? assignedInput.type : ''
    const currentName = typeof assignedInput?.name === 'string'
      ? assignedInput.name
      : (typeof action?.name === 'string' ? action.name : title)
    const existingDisplayType = this._displayClassFromInput(assignedInput)

    const initialInputClass = inputTypes.some(t => t.class === existingType)
      ? existingType
      : inputTypes[0].class
    const initialDisplayClass = displayTypes.some(d => d.class === existingDisplayType)
      ? existingDisplayType
      : displayTypes[0].class

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
        ? 'Edit the perform control for this target, or remove it. Param fields follow system.yml for the selected input type.'
        : 'Create a perform control: types and param fields are defined in hub systemCapabilities.'

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
      for (const t of inputTypes) {
        const o = document.createElement('option')
        o.value = t.class
        o.textContent = t.hint ? `${t.name} (${t.hint})` : t.name
        typeSelect.appendChild(o)
      }
      typeSelect.value = initialInputClass

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
      for (const d of displayTypes) {
        const o = document.createElement('option')
        o.value = d.class
        o.textContent = d.name
        displaySelect.appendChild(o)
      }
      displaySelect.value = initialDisplayClass

      const paramHost = document.createElement('div')
      paramHost.className = 'input-assign-modal__param-host'

      const setError = (message) => {
        if (!message) {
          errorEl.textContent = ''
          errorEl.hidden = true
          return
        }
        errorEl.textContent = message
        errorEl.hidden = false
      }

      const rebuildParamFields = () => {
        paramHost.innerHTML = ''
        const def = inputTypes.find(t => t.class === typeSelect.value)
        if (!def) return
        const keys = Object.keys(def.params)
        if (keys.length === 0) return
        for (const paramKey of keys) {
          const kind = def.params[paramKey]
          const label = document.createElement('label')
          label.className = 'input-assign-modal__label'
          label.textContent = `${paramKey} (${kind})`
          const ta = document.createElement('textarea')
          ta.className = 'modal-input input-assign-modal__json'
          ta.placeholder = '{}'
          ta.dataset.paramKey = paramKey
          ta.dataset.paramKind = kind
          ta.setAttribute('aria-label', paramKey)
          ta.value = stringifyJsonStringParam(params?.[paramKey])
          paramHost.appendChild(label)
          paramHost.appendChild(ta)
        }
      }

      typeSelect.addEventListener('change', () => {
        setError('')
        rebuildParamFields()
      })

      fields.appendChild(typeLabel)
      fields.appendChild(typeSelect)
      fields.appendChild(nameLabel)
      fields.appendChild(nameInput)
      fields.appendChild(displayLabel)
      fields.appendChild(displaySelect)
      fields.appendChild(paramHost)
      rebuildParamFields()

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
        const displayType = displaySelect.value
        const inputType = typeSelect.value
        const def = inputTypes.find(t => t.class === inputType)
        if (!def) {
          setError('Selected input type is not defined in system capabilities.')
          return
        }

        /** @type {Record<string, unknown>} */
        const inputPayload = { name, type: inputType, displayType }

        for (const ta of paramHost.querySelectorAll('textarea[data-param-key]')) {
          const paramKey = ta.getAttribute('data-param-key') ?? ''
          const kind = ta.getAttribute('data-param-kind') ?? ''
          if (!paramKey || !kind) continue
          const r = parseParamFromForm(kind, ta.value, paramKey)
          if (!r.ok) {
            setError(r.message)
            ta.focus()
            return
          }
          if (r.value !== undefined) {
            inputPayload[paramKey] = r.value
          }
        }

        sendActionInputCommand({
          command: 'ensureInputAssignment',
          targetType: this._targetType,
          targetGuid: this._targetGuid,
          input: inputPayload,
        })
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
   * @param {Record<string, unknown> | null | undefined} input
   * @returns {string}
   */
  _displayClassFromInput (input) {
    const display = input?.display
    if (!display || typeof display !== 'object' || Array.isArray(display)) return ''
    const record = /** @type {Record<string, unknown>} */ (display)
    return typeof record.type === 'string' ? record.type : ''
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
