import { getAssignmentClass, listAssignmentClasses } from './assignmentRegistry.js'
import { NOTE_AND_CONTROL_CLASS } from './viewers/noteAndControl.js'

/**
 * @param {{
 *   session: import('./assignSession.js').AssignSessionApi,
 *   els: {
 *     modal: HTMLElement,
 *     modalBody: HTMLElement,
 *     modalClose: HTMLButtonElement | null,
 *     modalBackdrop: HTMLElement | null
 *   },
 *   refreshList: () => void
 * }} opts
 */
export function createAssignModal (opts) {
  /** @type {Record<string, unknown> | null} */
  let editing = null
  let viewerTeardown = () => {}
  let viewerSync = () => {}
  let syncDeviceRow = () => {}

  const editorHost = document.createElement('div')
  editorHost.className = 'modal__editor'

  function buildApi () {
    return {
      getAssignment: () => /** @type {Record<string, unknown>} */ (editing),
      intents: opts.session.intents,
      systemCapabilities: opts.session.systemCapabilities,
      getIntentClass: guid => opts.session.getIntentClass(guid),
      requestLearn: o => {
        const g =
          editing && typeof editing.guid === 'string' ? editing.guid : ''
        if (g) opts.session.sendLearnStart(g, o.field, o.capture)
      },
      onChange: () => {
        if (!editing) return
        opts.session.mergeEditingIntoAssignments(editing)
        opts.refreshList()
        opts.session.scheduleSave()
      }
    }
  }

  function remountEditor () {
    viewerTeardown()
    editorHost.replaceChildren()
    viewerSync = () => {}
    if (!editing) return
    const cls = typeof editing.class === 'string' ? editing.class : ''
    const def = getAssignmentClass(cls)
    if (!def) return
    const v = def.mountEditor(editorHost, buildApi())
    viewerTeardown = v.teardown
    viewerSync = v.syncFromModel
  }

  function commitDevice () {
    if (!editing) return
    opts.session.mergeEditingIntoAssignments(editing)
    opts.refreshList()
    opts.session.scheduleSave()
  }

  /**
   * Class-independent device filter row. Lives in the shared chrome so every
   * receiver class gets it. "Any" on ⇒ the learned device is ignored (matches
   * all sources); off ⇒ only the learned device drives this assignment.
   */
  function buildDeviceRow () {
    const row = document.createElement('div')
    row.className = 'modal__row modal__row--device'

    const label = document.createElement('span')
    label.className = 'modal__field-label'
    label.textContent = 'Device:'
    row.appendChild(label)

    const anyWrap = document.createElement('label')
    anyWrap.className = 'modal__device-any'
    const anyChk = document.createElement('input')
    anyChk.type = 'checkbox'
    const anyText = document.createElement('span')
    anyText.textContent = 'Any'
    anyWrap.appendChild(anyChk)
    anyWrap.appendChild(anyText)
    anyChk.addEventListener('change', () => {
      if (!editing) return
      editing.deviceAny = anyChk.checked
      syncDeviceRow()
      commitDevice()
    })
    row.appendChild(anyWrap)

    const nameEl = document.createElement('span')
    nameEl.className = 'modal__device-name'
    row.appendChild(nameEl)

    const learnBtn = document.createElement('button')
    learnBtn.type = 'button'
    learnBtn.className = 'btn btn--compact'
    learnBtn.textContent = 'Device Learn'
    learnBtn.addEventListener('click', () => {
      const g = editing && typeof editing.guid === 'string' ? editing.guid : ''
      if (g) opts.session.sendLearnStart(g, 'device', 'any')
    })
    row.appendChild(learnBtn)

    syncDeviceRow = () => {
      if (!editing) return
      const any = editing.deviceAny === true
      anyChk.checked = any
      const dev = typeof editing.device === 'string' ? editing.device : ''
      nameEl.textContent = dev || '—'
      nameEl.classList.toggle('modal__device-name--ignored', any)
    }

    syncDeviceRow()
    return row
  }

  function ensureDeviceShape () {
    if (!editing) return
    if (typeof editing.device !== 'string') editing.device = ''
    if (typeof editing.deviceAny !== 'boolean') editing.deviceAny = true
  }

  function renderChrome () {
    ensureDeviceShape()
    const modalBody = opts.els.modalBody
    modalBody.replaceChildren()

    const headerRow = document.createElement('div')
    headerRow.className = 'modal__header-row'
    
    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'btn btn--compact'
    closeBtn.textContent = '⬅'
    closeBtn.addEventListener('click', () => {
      mergeBeforeClose()
      close()
    })
    headerRow.appendChild(closeBtn)

    const sel = document.createElement('select')
    sel.className = 'modal__select modal__select--header'
    const classes = listAssignmentClasses()
    for (const { id, label } of classes) {
      const opt = document.createElement('option')
      opt.value = id
      opt.textContent = label
      sel.appendChild(opt)
    }

    if (editing && !getAssignmentClass(String(editing.class ?? ''))) {
      editing.class = NOTE_AND_CONTROL_CLASS
    }
    let cur =
      editing && typeof editing.class === 'string'
        ? editing.class
        : NOTE_AND_CONTROL_CLASS
    if (!classes.some(c => c.id === cur) && classes[0]) cur = classes[0].id
    sel.value = cur
    if (editing) editing.class = cur

    sel.addEventListener('change', () => {
      if (!editing) return
      const id = sel.value
      const def = getAssignmentClass(id)
      if (!def) return
      const fresh = def.createDefault(opts.session.getEditorContext())
      editing.class = id
      editing.params = JSON.parse(JSON.stringify(fresh.params))
      remountEditor()
    })
    headerRow.appendChild(sel)
    
    const btnDel = document.createElement('button')
    btnDel.type = 'button'
    btnDel.className = 'btn btn--danger btn--compact'
    btnDel.textContent = '❌'
    btnDel.addEventListener('click', () => {
      const g = editing && typeof editing.guid === 'string' ? editing.guid : ''
      if (
        !g ||
        !window.confirm('Remove this assignment from the project?')
      ) {
        return
      }
      opts.session.deleteAssignment(g)
      opts.refreshList()
      opts.session.sendSave()
      close()
    })
    headerRow.appendChild(btnDel)
    
    modalBody.appendChild(headerRow)
    modalBody.appendChild(buildDeviceRow())
    modalBody.appendChild(editorHost)

    remountEditor()
  }

  function mergeBeforeClose () {
    if (!editing) return
    opts.session.mergeEditingIntoAssignments(editing)
    opts.refreshList()
    opts.session.scheduleSave()
  }

  function close () {
    viewerTeardown()
    viewerTeardown = () => {}
    syncDeviceRow = () => {}
    editing = null
    opts.els.modal.hidden = true
  }

  opts.els.modalClose?.addEventListener('click', () => {
    mergeBeforeClose()
    close()
  })
  opts.els.modalBackdrop?.addEventListener('click', () => {
    mergeBeforeClose()
    close()
  })

  const api = {
    /**
     * @param {Record<string, unknown>} row
     */
    openEdit (row) {
      editing = /** @type {Record<string, unknown>} */ (
        JSON.parse(JSON.stringify(row))
      )
      renderChrome()
      opts.els.modal.hidden = false
    },
    openCreate () {
      const classes = listAssignmentClasses()
      const def =
        getAssignmentClass(NOTE_AND_CONTROL_CLASS) ??
        (classes[0] ? getAssignmentClass(classes[0].id) : null)
      if (!def) return
      const row = def.createDefault(opts.session.getEditorContext())
      opts.session.pushAssignment(row)
      opts.refreshList()
      api.openEdit(row)
    },
    close,
    /** @param {Record<string, unknown>} msg */
    applyLearnValue (msg) {
      if (!editing || msg.assignmentGuid !== editing.guid) return
      const field = msg.field
      let changed = false
      // Every learn reports its source device; the note/controller Learn buttons
      // capture it as a side-effect. The "Any" toggle is left as the user set it.
      if (typeof msg.device === 'string') {
        editing.device = msg.device
        syncDeviceRow()
        changed = true
      }
      if (field === 'note' || field === 'controller') {
        const value = Number(msg.value)
        if (Number.isFinite(value)) {
          if (!editing.params || typeof editing.params !== 'object') {
            editing.params = {}
          }
          const pr = /** @type {Record<string, unknown>} */ (editing.params)
          pr[/** @type {'note'|'controller'} */ (field)] = Math.round(value)
          viewerSync()
          changed = true
        }
      }
      if (!changed) return
      opts.session.mergeEditingIntoAssignments(editing)
      opts.refreshList()
      opts.session.scheduleSave()
    }
  }
  return api
}
