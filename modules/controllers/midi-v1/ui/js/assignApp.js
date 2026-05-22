import { createAssignSession } from './assignSession.js'
import { createAssignList } from './assignList.js'
import { createAssignModal } from './assignModal.js'
import './viewers/noteAndControl.js'
import './viewers/noteOnOff.js'
import './viewers/noteOnOffToggle.js'

const filterParam = new URLSearchParams(window.location.search).get('filter')
const filterIntentGuid =
  typeof filterParam === 'string' && filterParam.trim() !== ''
    ? filterParam.trim()
    : null

const listEl = document.getElementById('list')
const listWrap = document.getElementById('list-wrap')
const bannerOffline = document.getElementById('banner-offline')
const modal = document.getElementById('modal')
const modalBody = document.getElementById('modal-body')
const modalClose = document.getElementById('modal-close')
const modalBackdrop = modal?.querySelector('.modal__backdrop') ?? null

if (!listEl || !listWrap || !modal || !modalBody) {
  throw new Error('assign: missing required DOM nodes')
}

function applyTheme (vars) {
  if (!vars || typeof vars !== 'object') return
  const root = document.documentElement
  for (const [k, v] of Object.entries(vars)) {
    if (typeof k === 'string' && typeof v === 'string')
      root.style.setProperty(k, v)
  }
}

window.addEventListener('message', ev => {
  const d = ev.data
  if (d && typeof d === 'object' && d.type === 'theme' && d.vars)
    applyTheme(d.vars)
})

/** @type {ReturnType<typeof createAssignModal> | null} */
let modalRef = null

/** @type {ReturnType<typeof createAssignList> | null} */
let listRef = null

const session = createAssignSession({
  filterIntentGuid,
  onState: () => {
    listRef?.render()
  },
  onOnline: () => {
    if (bannerOffline) bannerOffline.hidden = true
  },
  onOffline: () => {
    if (bannerOffline) bannerOffline.hidden = false
  },
  onAssignmentTrigger: (assignmentGuid, input, result) => {
    listRef?.pulseAssignment(assignmentGuid)
    listRef?.updateAssignmentActivity(assignmentGuid, input, result)
  },
  onAssignmentEngaged: (assignmentGuid, engaged) => {
    listRef?.setAssignmentEngaged(assignmentGuid, engaged)
  },
  getModal: () => modalRef
})

listRef = createAssignList({
  session,
  listEl,
  listWrap,
  filterIntentGuid,
  onEdit: row => modalRef?.openEdit(row),
  onCreate: () => modalRef?.openCreate()
})

const list = listRef

modalRef = createAssignModal({
  session,
  els: {
    modal,
    modalBody,
    modalClose,
    modalBackdrop
  },
  refreshList: () => listRef?.render()
})

if (bannerOffline) bannerOffline.hidden = true
