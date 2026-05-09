;(function () {
  const listEl = document.getElementById('list')
  const bannerOffline = document.getElementById('banner-offline')
  const modal = document.getElementById('modal')
  const modalBody = document.getElementById('modal-body')
  const modalClose = document.getElementById('modal-close')

  /** @type {unknown[]} */
  let assignments = []
  let ws = null
  let reconnectTimer = null
  /** @type {ReturnType<typeof setTimeout> | null} */
  let saveTimer = null
  const SAVE_DEBOUNCE_MS = 280

  function wsUrlFromPage () {
    const { protocol, host } = window.location
    const wsProto = protocol === 'https:' ? 'wss:' : 'ws:'
    return `${wsProto}//${host}/ws`
  }

  function applyTheme (vars) {
    if (!vars || typeof vars !== 'object') return
    const root = document.documentElement
    for (const [k, v] of Object.entries(vars)) {
      if (typeof k === 'string' && typeof v === 'string') root.style.setProperty(k, v)
    }
  }

  window.addEventListener('message', ev => {
    const d = ev.data
    if (d && typeof d === 'object' && d.type === 'theme' && d.vars) applyTheme(d.vars)
  })

  function sendSave () {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'save', assignments }))
    }
  }

  function scheduleSave () {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      sendSave()
    }, SAVE_DEBOUNCE_MS)
  }

  function connect () {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    const url = wsUrlFromPage()
    ws = new WebSocket(url)
    bannerOffline.hidden = true

    ws.onopen = () => {
      bannerOffline.hidden = true
    }

    ws.onclose = () => {
      bannerOffline.hidden = false
      ws = null
      reconnectTimer = window.setTimeout(connect, 1500)
    }

    ws.onerror = () => {}

    ws.onmessage = ev => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.type === 'state' && Array.isArray(msg.assignments)) {
        assignments = msg.assignments.map(a => JSON.parse(JSON.stringify(a)))
        renderList()
      }
      if (msg.type === 'learnValue' && editing && msg.assignmentGuid === editing.guid && msg.field === 'note') {
        const n = Number(msg.value)
        if (Number.isFinite(n) && editing.params) {
          editing.params.note = n
          if (noteInput) noteInput.value = String(n)
          const g = typeof editing.guid === 'string' ? editing.guid : ''
          const idx = assignments.findIndex(
            x => x && typeof x === 'object' && /** @type {Record<string, unknown>} */ (x).guid === g
          )
          if (idx >= 0) assignments[idx] = JSON.parse(JSON.stringify(editing))
          renderList()
          sendSave()
        }
        closeModal()
      }
    }
  }

  function rowSummary (a) {
    const s = typeof a.summary === 'string' ? a.summary.trim() : ''
    if (s) return s
    const cls = typeof a.class === 'string' ? a.class : ''
    return cls || 'Assignment'
  }

  function renderList () {
    if (!listEl) return
    listEl.innerHTML = ''
    for (const raw of assignments) {
      if (!raw || typeof raw !== 'object') continue
      const a = /** @type {Record<string, unknown>} */ (raw)
      const guid = typeof a.guid === 'string' ? a.guid : ''
      if (!guid) continue
      const li = document.createElement('li')
      li.className = 'list__item'
      const summaryEl = document.createElement('div')
      summaryEl.className = 'list__summary'
      summaryEl.textContent = rowSummary(a)
      const actions = document.createElement('div')
      actions.className = 'list__actions'
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'btn'
      btn.textContent = 'Edit'
      btn.addEventListener('click', () => openEdit(raw))
      const btnDel = document.createElement('button')
      btnDel.type = 'button'
      btnDel.className = 'btn btn--danger'
      btnDel.textContent = 'Delete'
      btnDel.addEventListener('click', () => deleteAssignment(guid))
      actions.appendChild(btn)
      actions.appendChild(btnDel)
      li.appendChild(summaryEl)
      li.appendChild(actions)
      listEl.appendChild(li)
    }
  }

  function deleteAssignment (guid) {
    if (!guid) return
    if (typeof window !== 'undefined' && !window.confirm('Remove this assignment?')) return
    assignments = assignments.filter(
      x => !(x && typeof x === 'object' && /** @type {Record<string, unknown>} */ (x).guid === guid)
    )
    renderList()
    sendSave()
  }

  /** @type {Record<string, unknown> | null} */
  let editing = null
  /** @type {HTMLInputElement | null} */
  let noteInput = null

  function mergeEditingIntoAssignments () {
    if (!editing || !noteInput || !editing.params) return
    const n = Number(noteInput.value)
    if (Number.isFinite(n)) editing.params.note = n
    const g = typeof editing.guid === 'string' ? editing.guid : ''
    const idx = assignments.findIndex(
      x => x && typeof x === 'object' && /** @type {Record<string, unknown>} */ (x).guid === g
    )
    if (idx >= 0) assignments[idx] = JSON.parse(JSON.stringify(editing))
  }

  function openEdit (row) {
    editing = /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(row)))
    if (!modal || !modalBody) return
    modalBody.innerHTML = ''
    const guid = typeof editing.guid === 'string' ? editing.guid : ''
    const params =
      editing.params && typeof editing.params === 'object' && !Array.isArray(editing.params)
        ? /** @type {Record<string, unknown>} */ (editing.params)
        : {}
    if (!editing.params) editing.params = params

    const label = document.createElement('label')
    label.textContent = 'Note number'
    noteInput = document.createElement('input')
    noteInput.type = 'number'
    noteInput.min = '0'
    noteInput.max = '127'
    noteInput.value = String(typeof params.note === 'number' ? params.note : 60)
    noteInput.addEventListener('input', () => {
      mergeEditingIntoAssignments()
      scheduleSave()
    })

    const learnRow = document.createElement('div')
    learnRow.className = 'learn-row'
    const btnLearn = document.createElement('button')
    btnLearn.type = 'button'
    btnLearn.className = 'btn'
    btnLearn.textContent = 'Learn'
    btnLearn.addEventListener('click', () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'learnStart', assignmentGuid: guid, field: 'note' }))
      }
    })
    learnRow.appendChild(btnLearn)
    learnRow.appendChild(document.createTextNode('Play a note on your controller'))

    modalBody.appendChild(label)
    modalBody.appendChild(noteInput)
    modalBody.appendChild(learnRow)
    modal.hidden = false
  }

  function closeModal () {
    editing = null
    noteInput = null
    if (modal) modal.hidden = true
  }

  modalClose?.addEventListener('click', () => {
    mergeEditingIntoAssignments()
    renderList()
    sendSave()
    closeModal()
  })

  modal?.querySelector('.modal__backdrop')?.addEventListener('click', () => {
    mergeEditingIntoAssignments()
    renderList()
    sendSave()
    closeModal()
  })

  connect()
})()
