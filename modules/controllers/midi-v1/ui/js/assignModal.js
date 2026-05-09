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

  const editorHost = document.createElement('div')
  editorHost.className = 'modal__editor'

  function buildApi () {
    return {
      getAssignment: () => /** @type {Record<string, unknown>} */ (editing),
      intents: opts.session.intents,
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

  function renderChrome () {
    const modalBody = opts.els.modalBody
    modalBody.replaceChildren()

    const classRow = document.createElement('div')
    classRow.className = 'modal__row modal__row--class'
    const sel = document.createElement('select')
    sel.className = 'modal__select'
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
    classRow.appendChild(sel)
    modalBody.appendChild(classRow)
    modalBody.appendChild(editorHost)

    const btnDel = document.createElement('button')
    btnDel.type = 'button'
    btnDel.className = 'btn btn--danger btn--compact'
    btnDel.textContent = 'Delete'
    btnDel.addEventListener('click', () => {
      const g = editing && typeof editing.guid === 'string' ? editing.guid : ''
      if (g) {
        opts.session.deleteAssignment(g)
        opts.refreshList()
        opts.session.sendSave()
      }
      close()
    })
    modalBody.appendChild(btnDel)

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
      if (field !== 'note' && field !== 'controller') return
      const value = Number(msg.value)
      if (!Number.isFinite(value)) return
      if (!editing.params || typeof editing.params !== 'object') {
        editing.params = {}
      }
      const pr = /** @type {Record<string, unknown>} */ (editing.params)
      pr[/** @type {'note'|'controller'} */ (field)] = Math.round(value)
      viewerSync()
      opts.session.mergeEditingIntoAssignments(editing)
      opts.refreshList()
      opts.session.scheduleSave()
    }
  }
  return api
}
