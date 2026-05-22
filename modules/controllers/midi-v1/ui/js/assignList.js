import { getAssignmentClass } from './assignmentRegistry.js'

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

  /** @type {HTMLElement | null} */
  let emptyHint = null

  /** Cache of last-seen (input, result) per assignment guid, so re-renders keep the last value. */
  /** @type {Map<string, { input: number | null, result: number | null }>} */
  const lastActivity = new Map()

  /** noteAndControl: armed after matching note-on until note-off (plugin UI orange frame). */
  /** @type {Set<string>} */
  const engagedGuids = new Set()

  /** noteOnOffToggle: latched on until next tap (plugin UI persistent blue frame). */
  /** @type {Set<string>} */
  const latchedGuids = new Set()

  function rowSummary (a) {
    const s = typeof a.summary === 'string' ? a.summary.trim() : ''
    if (s) return s
    const cls = typeof a.class === 'string' ? a.class : ''
    return cls || 'Assignment'
  }

  /**
   * @param {Record<string, unknown>} a
   * @param {number | null} input
   * @param {number | null} result
   * @returns {string}
   */
  function buildActivityText (a, input, result) {
    const cls = typeof a.class === 'string' ? a.class : ''
    const def = cls ? getAssignmentClass(cls) : undefined
    if (def && typeof def.formatActivity === 'function') {
      return def.formatActivity(a, input, result)
    }
    if (input === null && result === null) return ''
    const inStr = input !== null ? String(Math.round(input)) : '—'
    const outStr = result !== null ? String(Math.round(result)) : '—'
    return `${inStr} ⮕ ${outStr}`
  }

  /**
   * @param {string} guid
   * @returns {Record<string, unknown> | null}
   */
  function lookupAssignment (guid) {
    for (const raw of opts.session.assignments) {
      if (!raw || typeof raw !== 'object') continue
      const a = /** @type {Record<string, unknown>} */ (raw)
      if (a.guid === guid) return a
    }
    return null
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
    const knownGuids = new Set()
    for (const raw of opts.session.assignments) {
      if (!raw || typeof raw !== 'object') continue
      const a = /** @type {Record<string, unknown>} */ (raw)
      const g = typeof a.guid === 'string' ? a.guid : ''
      if (g) knownGuids.add(g)
    }
    for (const g of [...engagedGuids]) {
      if (!knownGuids.has(g)) engagedGuids.delete(g)
    }
    for (const g of [...latchedGuids]) {
      if (!knownGuids.has(g)) latchedGuids.delete(g)
    }
    listEl.innerHTML = ''
    for (const raw of opts.session.assignments) {
      if (!raw || typeof raw !== 'object') continue
      const a = /** @type {Record<string, unknown>} */ (raw)
      const guid = typeof a.guid === 'string' ? a.guid : ''
      if (!guid) continue
      if (!assignmentMatchesIntentFilter(a)) continue
      const li = document.createElement('li')
      li.className = 'list__item'
      if (engagedGuids.has(guid)) li.classList.add('list__item--engaged')
      if (latchedGuids.has(guid)) li.classList.add('list__item--latched')
      li.dataset.assignmentGuid = guid
      const summaryEl = document.createElement('div')
      summaryEl.className = 'list__summary'
      summaryEl.textContent = rowSummary(a)
      const actions = document.createElement('div')
      actions.className = 'list__actions'
      const activityEl = document.createElement('span')
      activityEl.className = 'list__activity'
      const cached = lastActivity.get(guid)
      if (cached) {
        const text = buildActivityText(a, cached.input, cached.result)
        if (text) activityEl.textContent = text
      }
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'btn'
      btn.textContent = '✎'
      btn.addEventListener('click', () => opts.onEdit(a))
      actions.appendChild(activityEl)
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

    const isEmpty = listEl.childElementCount === 0
    if (!isEmpty && emptyHint) {
      emptyHint.remove()
      emptyHint = null
    } else if (isEmpty && opts.listWrap && !emptyHint) {
      emptyHint = document.createElement('p')
      emptyHint.className = 'list-empty'
      emptyHint.textContent = hasFilter
        ? 'No assignments yet — press Create to add one.'
        : 'Select an intent to create a new assignment.'
      opts.listWrap.insertBefore(emptyHint, listFooter ?? null)
    } else if (isEmpty && emptyHint) {
      emptyHint.textContent = hasFilter
        ? 'No assignments yet — press Create to add one.'
        : 'Select an intent to create a new assignment.'
    }
  }

  /**
   * @param {string} assignmentGuid
   */
  function pulseAssignment (assignmentGuid) {
    const root = opts.listEl
    if (!root || typeof assignmentGuid !== 'string' || !assignmentGuid) return
    const item = root.querySelector(
      `li.list__item[data-assignment-guid="${CSS.escape(assignmentGuid)}"]`
    )
    if (!item) return
    item.classList.remove('list__item--trigger')
    // retrigger animation if same row fires again quickly
    void item.offsetWidth
    item.classList.add('list__item--trigger')
    const done = () => item.classList.remove('list__item--trigger')
    item.addEventListener('animationend', done, { once: true })
    window.setTimeout(done, 550)
  }

  /**
   * @param {string} assignmentGuid
   * @param {number | null} input
   * @param {number | null} result
   */
  function updateAssignmentActivity (assignmentGuid, input, result) {
    if (typeof assignmentGuid !== 'string' || !assignmentGuid) return
    if (input === null && result === null) return
    const prev = lastActivity.get(assignmentGuid) ?? { input: null, result: null }
    const nextInput = input !== null ? input : prev.input
    const nextResult = result !== null ? result : prev.result
    lastActivity.set(assignmentGuid, { input: nextInput, result: nextResult })
    const root = opts.listEl
    if (!root) return
    const item = root.querySelector(
      `li.list__item[data-assignment-guid="${CSS.escape(assignmentGuid)}"]`
    )
    if (!item) return
    const activityEl = item.querySelector('.list__activity')
    if (!(activityEl instanceof HTMLElement)) return
    const a = lookupAssignment(assignmentGuid)
    if (!a) return
    activityEl.textContent = buildActivityText(a, nextInput, nextResult)
  }

  /**
   * @param {string} assignmentGuid
   * @param {boolean} engaged
   */
  function setAssignmentEngaged (assignmentGuid, engaged) {
    if (typeof assignmentGuid !== 'string' || !assignmentGuid) return
    const a = lookupAssignment(assignmentGuid)
    const isToggle = a?.class === 'noteOnOffToggle'
    if (isToggle) {
      if (engaged) latchedGuids.add(assignmentGuid)
      else latchedGuids.delete(assignmentGuid)
    } else {
      if (engaged) engagedGuids.add(assignmentGuid)
      else engagedGuids.delete(assignmentGuid)
    }
    const root = opts.listEl
    if (!root) return
    const item = root.querySelector(
      `li.list__item[data-assignment-guid="${CSS.escape(assignmentGuid)}"]`
    )
    if (!item) return
    if (isToggle) {
      item.classList.toggle('list__item--latched', engaged)
      return
    }
    item.classList.toggle('list__item--engaged', engaged)
  }

  return { render, pulseAssignment, updateAssignmentActivity, setAssignmentEngaged }
}
