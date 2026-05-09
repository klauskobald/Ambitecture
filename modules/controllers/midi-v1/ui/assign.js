;(function () {
  const listEl = document.getElementById('list')
  const btnSave = document.getElementById('btn-save')
  const bannerOffline = document.getElementById('banner-offline')
  const modal = document.getElementById('modal')
  const modalBody = document.getElementById('modal-body')
  const modalClose = document.getElementById('modal-close')

  /** @type {unknown[]} */
  let assignments = []
  let ws = null
  let reconnectTimer = null

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

  function connect () {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    const url = wsUrlFromPage()
    ws = new WebSocket(url)
    bannerOffline.hidden = true
    btnSave.disabled = true

    ws.onopen = () => {
      bannerOffline.hidden = true
      btnSave.disabled = false
    }

    ws.onclose = () => {
      bannerOffline.hidden = false
      btnSave.disabled = true
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
        assignments = msg.assignments.map(a => structuredClone(a))
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
        }
        closeModal()
      }
    }
  }

  function renderList () {
    if (!listEl) return
    listEl.innerHTML = ''
    for (const raw of assignments) {
      if (!raw || typeof raw !== 'object') continue
      const a = /** @type {Record<string, unknown>} */ (raw)
      const guid = typeof a.guid === 'string' ? a.guid : ''
      const cls = typeof a.class === 'string' ? a.class : ''
      const params = a.params && typeof a.params === 'object' && !Array.isArray(a.params)
        ? /** @type {Record<string, unknown>} */ (a.params)
        : {}
      const note = typeof params.note === 'number' ? params.note : '—'
      const li = document.createElement('li')
      li.className = 'list__item'
      const left = document.createElement('div')
      left.innerHTML = `<strong>${escapeHtml(guid || 'assignment')}</strong><div class="list__meta">${escapeHtml(cls)} · note ${escapeHtml(String(note))}</div>`
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'btn'
      btn.textContent = 'Edit'
      btn.addEventListener('click', () => openEdit(raw))
      li.appendChild(left)
      li.appendChild(btn)
      listEl.appendChild(li)
    }
  }

  function escapeHtml (s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  /** @type {Record<string, unknown> | null} */
  let editing = null
  /** @type {HTMLInputElement | null} */
  let noteInput = null

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
    if (editing && noteInput && editing.params) {
      const n = Number(noteInput.value)
      if (Number.isFinite(n)) editing.params.note = n
      const idx = assignments.findIndex(
        x => x && typeof x === 'object' && /** @type {Record<string, unknown>} */ (x).guid === editing?.guid
      )
      if (idx >= 0 && editing) assignments[idx] = editing
      renderList()
    }
    closeModal()
  })

  modal?.querySelector('.modal__backdrop')?.addEventListener('click', closeModal)

  btnSave?.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'save', assignments }))
    }
  })

  connect()
})()
