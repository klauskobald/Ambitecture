import { projectGraph } from '../core/projectGraph.js'
import { sendGraphCommand } from '../core/outboundQueue.js'
import { openModalCard } from '../core/Modal.js'

/**
 * Multi-toggle modal: choose which scenes a connector is active in. An empty selection (or one
 * covering every scene) is persisted as `inScenes: []`, the canonical "active in all scenes".
 * @param {string} connectorGuid
 * @param {Record<string, unknown>} connector
 * @returns {Promise<void>}
 */
export async function openConnectorScenesPicker (connectorGuid, connector) {
  const sceneRows = projectGraph
    .getScenesData()
    .filter(s => typeof s.guid === 'string' && s.guid.length > 0)
    .map(s => ({ guid: /** @type {string} */ (s.guid), name: s.name || s.guid }))

  const initial = Array.isArray(connector.inScenes)
    ? /** @type {string[]} */ (connector.inScenes)
    : []
  /** @type {Set<string>} */
  const pending = new Set(initial)

  await openModalCard(dismiss => {
    const isAllSelected = () =>
      sceneRows.length > 0 && sceneRows.every(r => pending.has(r.guid))

    /** @type {Map<string, HTMLElement>} */
    const rowButtons = new Map()

    /** @param {string} guid */
    const paintRow = guid => {
      const btn = rowButtons.get(guid)
      if (!btn) return
      const on = pending.has(guid)
      btn.classList.toggle('modal-choice-list__btn--selected', on)
      btn.setAttribute('aria-pressed', on ? 'true' : 'false')
    }

    const paintAllToggle = () => {
      allBtn.textContent = isAllSelected() ? 'One' : 'All'
    }

    const finish = (/** @type {boolean} */ committed) => {
      if (committed) {
        const inScenes = isAllSelected() ? [] : [...pending]
        projectGraph.putConnectorRecord({ ...connector, inScenes })
        sendGraphCommand({
          op: 'patch',
          entityType: 'connector',
          guid: connectorGuid,
          patch: { inScenes },
          persistence: 'runtimeAndDurable'
        })
      }
      dismiss(committed ? true : null)
    }

    const card = document.createElement('div')
    card.className = 'modal input-assign-modal input-assign-modal--assign-picker'
    card.addEventListener('click', e => e.stopPropagation())

    const heading = document.createElement('p')
    heading.className = 'modal-text'
    heading.textContent = 'Active in scenes'

    const allBtn = document.createElement('button')
    allBtn.type = 'button'
    allBtn.className = 'btn connector-scenes-picker__all'
    allBtn.style.flexShrink = '0'
    allBtn.style.alignSelf = 'flex-start'
    allBtn.addEventListener('click', () => {
      if (isAllSelected()) {
        const current = projectGraph.getActiveSceneGuid()
        pending.clear()
        if (typeof current === 'string' && current.length > 0) pending.add(current)
      } else {
        for (const row of sceneRows) pending.add(row.guid)
      }
      for (const row of sceneRows) paintRow(row.guid)
      paintAllToggle()
    })

    const listHost = document.createElement('div')
    listHost.className = 'modal-choice-list input-assign-modal__assign-scroll'

    for (const row of sceneRows) {
      const wrap = document.createElement('div')
      wrap.className = 'modal-choice-list__row'

      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'btn modal-choice-list__btn'
      btn.style.flex = '1 1 auto'
      btn.textContent = row.name
      btn.title = row.guid
      btn.addEventListener('click', () => {
        if (pending.has(row.guid)) pending.delete(row.guid)
        else pending.add(row.guid)
        paintRow(row.guid)
        paintAllToggle()
      })

      rowButtons.set(row.guid, btn)
      wrap.appendChild(btn)
      listHost.appendChild(wrap)
      paintRow(row.guid)
    }

    paintAllToggle()

    const footer = document.createElement('div')
    footer.className = 'modal-actions'
    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.className = 'btn'
    cancelBtn.textContent = 'Cancel'
    cancelBtn.addEventListener('click', () => finish(false))

    const okBtn = document.createElement('button')
    okBtn.type = 'button'
    okBtn.className = 'btn btn--primary'
    okBtn.textContent = 'OK'
    okBtn.addEventListener('click', () => finish(true))

    footer.appendChild(cancelBtn)
    footer.appendChild(okBtn)

    card.appendChild(heading)
    card.appendChild(allBtn)
    card.appendChild(listHost)
    card.appendChild(footer)

    requestAnimationFrame(() => okBtn.focus({ preventScroll: true }))

    return card
  })
}
