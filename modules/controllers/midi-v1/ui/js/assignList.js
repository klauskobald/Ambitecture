/**
 * @param {{
 *   session: import('./assignSession.js').AssignSessionApi,
 *   listEl: HTMLElement | null,
 *   listWrap: HTMLElement | null,
 *   filterIntentGuid: string | null,
 *   onEdit: (row: Record<string, unknown>) => void,
 *   onCreate: () => void
 * }} opts
 */
export function createAssignList (opts) {
  /** @type {HTMLElement | null} */
  let listFooter = null

  function rowSummary (a) {
    const s = typeof a.summary === 'string' ? a.summary.trim() : ''
    if (s) return s
    const cls = typeof a.class === 'string' ? a.class : ''
    return cls || 'Assignment'
  }

  /**
   * @param {Record<string, unknown>} a
   * @returns {boolean}
   */
  function assignmentMatchesIntentFilter (a) {
    if (!opts.filterIntentGuid) return true
    const targets = a.targets
    if (!Array.isArray(targets)) return false
    for (const t of targets) {
      if (!t || typeof t !== 'object' || Array.isArray(t)) continue
      const rec = /** @type {Record<string, unknown>} */ (t)
      if (
        rec.type === 'intent' &&
        typeof rec.guid === 'string' &&
        rec.guid === opts.filterIntentGuid
      )
        return true
    }
    return false
  }

  function render () {
    const listEl = opts.listEl
    if (!listEl) return
    listEl.innerHTML = ''
    for (const raw of opts.session.assignments) {
      if (!raw || typeof raw !== 'object') continue
      const a = /** @type {Record<string, unknown>} */ (raw)
      const guid = typeof a.guid === 'string' ? a.guid : ''
      if (!guid) continue
      if (!assignmentMatchesIntentFilter(a)) continue
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
      btn.textContent = '✎'
      btn.addEventListener('click', () => opts.onEdit(a))
      actions.appendChild(btn)
      li.appendChild(summaryEl)
      li.appendChild(actions)
      listEl.appendChild(li)
    }

    const hasFilter = Boolean(opts.filterIntentGuid)
    if (!hasFilter && listFooter) {
      listFooter.remove()
      listFooter = null
    } else if (hasFilter && opts.listWrap && !listFooter) {
      listFooter = document.createElement('div')
      listFooter.className = 'list-footer'
      const createBtn = document.createElement('button')
      createBtn.type = 'button'
      createBtn.className = 'btn list-footer__create'
      createBtn.textContent = 'Create'
      createBtn.addEventListener('click', () => opts.onCreate())
      listFooter.appendChild(createBtn)
      opts.listWrap.appendChild(listFooter)
    }
  }

  return { render }
}
