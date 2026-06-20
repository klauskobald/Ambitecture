/**
 * Perform → Snapshot pane: capture, list, modify recall toggles, perform assign.
 */

import { projectGraph } from '../core/projectGraph.js'
import {
  sendSnapshotCapture,
  sendSnapshotMetadataPatch,
  sendSnapshotRemove,
  sendActionTrigger
} from '../core/outboundQueue.js'
import { openModalCard, confirm as modalConfirm } from '../core/Modal.js'
import { InputAssignManager } from '../edit/InputAssignManager.js'

/**
 * @param {unknown} recall
 * @returns {string}
 */
function formatRecallLabels (recall) {
  if (!recall || typeof recall !== 'object' || Array.isArray(recall)) return ''
  const r = /** @type {Record<string, unknown>} */ (recall)
  /** @type {string[]} */
  const parts = []
  if (r.scene === true) parts.push('Scene')
  if (r.pulse === true) parts.push('Pulse')
  if (r.animations === true) parts.push('Anim')
  return parts.join(' · ')
}

/**
 * @param {Record<string, unknown>} [initial]
 * @returns {Promise<{ intent: 'save' | 'capture', name: string, recall: { scene: boolean, pulse: boolean, animations: boolean } } | null>}
 */
function openSnapshotModal (initial) {
  const initName = typeof initial?.name === 'string' ? initial.name : ''
  const initRecall = initial?.recall && typeof initial.recall === 'object' && !Array.isArray(initial.recall)
    ? /** @type {Record<string, unknown>} */ (initial.recall)
    : {}
  const isModify = Boolean(initial)
  const title = isModify ? 'Modify Snapshot' : 'New Snapshot'

  return openModalCard((dismiss) => {
    const card = document.createElement('div')
    card.className = 'modal modal--snapshot'

    const titleEl = document.createElement('h2')
    titleEl.className = 'modal__title'
    titleEl.textContent = title
    card.appendChild(titleEl)

    const body = document.createElement('div')
    body.className = 'modal__body perform-snapshot-modal__body'
    card.appendChild(body)

    const nameRow = document.createElement('label')
    nameRow.className = 'perform-snapshot-modal__field'
    const nameLabel = document.createElement('span')
    nameLabel.className = 'perform-snapshot-modal__label'
    nameLabel.textContent = 'Name'
    const nameInput = document.createElement('input')
    nameInput.type = 'text'
    nameInput.className = 'modal-input'
    nameInput.value = initName
    nameInput.placeholder = 'Snapshot name'
    nameRow.appendChild(nameLabel)
    nameRow.appendChild(nameInput)
    body.appendChild(nameRow)

    const toggles = document.createElement('div')
    toggles.className = 'perform-snapshot-modal__toggles'
    /** @type {Record<string, HTMLInputElement>} */
    const toggleInputs = {}

    for (const [key, label] of [
      ['scene', 'Scene'],
      ['pulse', 'Pulses + Speed'],
      ['animations', 'Animations + Speed']
    ]) {
      const row = document.createElement('label')
      row.className = 'perform-snapshot-modal__toggle'
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.checked = initRecall[key] !== false
      toggleInputs[key] = cb
      const span = document.createElement('span')
      span.textContent = label
      row.appendChild(cb)
      row.appendChild(span)
      toggles.appendChild(row)
    }
    body.appendChild(toggles)

    /** @returns {{ name: string, recall: { scene: boolean, pulse: boolean, animations: boolean } } | null} */
    function readForm () {
      const name = nameInput.value.trim()
      if (!name) return null
      return {
        name,
        recall: {
          scene: toggleInputs.scene.checked,
          pulse: toggleInputs.pulse.checked,
          animations: toggleInputs.animations.checked
        }
      }
    }

    const actions = document.createElement('div')
    actions.className = 'modal__actions'
    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.className = 'btn'
    cancelBtn.textContent = 'Cancel'
    cancelBtn.addEventListener('click', () => dismiss(null))
    actions.appendChild(cancelBtn)
    if (isModify) {
      const captureBtn = document.createElement('button')
      captureBtn.type = 'button'
      captureBtn.className = 'btn'
      captureBtn.textContent = 'Capture'
      captureBtn.addEventListener('click', () => {
        const form = readForm()
        if (!form) return
        dismiss({ intent: 'capture', ...form })
      })
      actions.appendChild(captureBtn)
    }
    const saveBtn = document.createElement('button')
    saveBtn.type = 'button'
    saveBtn.className = 'btn btn--primary'
    saveBtn.textContent = 'Save'
    saveBtn.addEventListener('click', () => {
      const form = readForm()
      if (!form) return
      dismiss({ intent: 'save', ...form })
    })
    actions.appendChild(saveBtn)
    card.appendChild(actions)

    setTimeout(() => nameInput.focus(), 0)
    return card
  })
}

/**
 * @returns {{ panel: HTMLDivElement }}
 */
export function createPerformSnapshotPanel () {
  const panel = document.createElement('div')
  panel.className = 'perform-subpane perform-subpane--snapshot'

  const list = document.createElement('div')
  list.className = 'perform-snapshot-list'
  list.setAttribute('role', 'list')
  panel.appendChild(list)

  async function onCreateClick () {
    const result = await openSnapshotModal(null)
    if (!result) return
    sendSnapshotCapture({
      name: result.name,
      recall: result.recall
    })
  }

  /** @type {(() => void) | null} */
  let unsubscribe = null

  function appendCreateFooter () {
    const footer = document.createElement('div')
    footer.className = 'perform-animate-empty__actions perform-snapshot-footer'
    const createBtn = document.createElement('button')
    createBtn.type = 'button'
    createBtn.className = 'btn perform-animate-empty__create'
    createBtn.textContent = 'Create'
    createBtn.dataset.help = 'snapshot.create'
    createBtn.addEventListener('click', () => {
      void onCreateClick()
    })
    footer.appendChild(createBtn)
    list.appendChild(footer)
  }

  function renderList () {
    list.innerHTML = ''
    const rows = projectGraph.getSnapshotsList()
    if (rows.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'perform-snapshot-empty'
      empty.textContent = 'No snapshots yet.'
      list.appendChild(empty)
      appendCreateFooter()
      return
    }

    for (const row of rows) {
      const guid = typeof row.guid === 'string' ? row.guid : ''
      if (!guid) continue
      const name = typeof row.name === 'string' && row.name.length > 0 ? row.name : guid

      const item = document.createElement('div')
      item.className = 'perform-snapshot-row'
      item.setAttribute('role', 'listitem')

      const main = document.createElement('div')
      main.className = 'perform-snapshot-row__label'
      const nameEl = document.createElement('span')
      nameEl.className = 'perform-snapshot-row__name'
      nameEl.textContent = name
      main.appendChild(nameEl)
      const recallText = formatRecallLabels(row.recall)
      if (recallText) {
        const labelsEl = document.createElement('span')
        labelsEl.className = 'perform-snapshot-row__recall'
        labelsEl.textContent = recallText
        main.appendChild(labelsEl)
      }
      item.appendChild(main)

      const assignHost = document.createElement('div')
      assignHost.className = 'perform-snapshot-row__assign'
      const iam = new InputAssignManager({
        context: { type: 'snapshot', guid },
        labelDefault: name
      })
      assignHost.appendChild(iam.getInlinePane({
        rowClass: 'input-assign-inline-row perform-snapshot-assign-row',
        toggleClass: 'intent-toggle perform-snapshot-assign-button'
      }))
      item.appendChild(assignHost)

      const playBtn = document.createElement('button')
      playBtn.type = 'button'
      playBtn.className = 'perform-animate-toggle perform-animate-toggle--play'
      playBtn.textContent = '▶'
      playBtn.dataset.help = 'snapshot.play'
      playBtn.setAttribute('aria-label', `Recall snapshot ${name}`)
      playBtn.addEventListener('click', () => {
        sendActionTrigger(guid)
      })
      item.appendChild(playBtn)

      const actions = document.createElement('div')
      actions.className = 'perform-snapshot-row__actions'
      const modifyBtn = document.createElement('button')
      modifyBtn.type = 'button'
      modifyBtn.className = 'btn perform-snapshot-row__btn'
      modifyBtn.textContent = 'Modify'
      modifyBtn.dataset.help = 'snapshot.modify'
      modifyBtn.addEventListener('click', async () => {
        const result = await openSnapshotModal(row)
        if (!result) return
        if (result.intent === 'capture') {
          sendSnapshotCapture({
            guid,
            name: result.name,
            recall: result.recall
          })
          return
        }
        sendSnapshotMetadataPatch(guid, {
          name: result.name,
          recall: result.recall
        })
        projectGraph.applyGraphDelta({
          entityType: 'snapshot',
          op: 'patch',
          guid,
          patch: {
            name: result.name,
            recall: result.recall
          }
        })
      })
      const deleteBtn = document.createElement('button')
      deleteBtn.type = 'button'
      deleteBtn.className = 'btn perform-snapshot-row__btn'
      deleteBtn.textContent = 'Delete'
      deleteBtn.dataset.help = 'snapshot.delete'
      deleteBtn.addEventListener('click', async () => {
        const ok = await modalConfirm(`Delete snapshot "${name}"?`, {
          yes: 'Delete',
          no: 'Cancel'
        })
        if (!ok) return
        sendSnapshotRemove(guid)
        projectGraph.applyGraphDelta({
          entityType: 'snapshot',
          op: 'remove',
          guid
        })
        projectGraph.applyGraphDelta({
          entityType: 'action',
          op: 'remove',
          guid
        })
      })
      actions.appendChild(modifyBtn)
      actions.appendChild(deleteBtn)
      item.appendChild(actions)

      list.appendChild(item)
    }
    appendCreateFooter()
  }

  unsubscribe = projectGraph.subscribe(['snapshots', 'actions', 'inputs'], () => {
    renderList()
  })
  renderList()

  return { panel }
}
