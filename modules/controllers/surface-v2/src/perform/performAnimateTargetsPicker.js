import { projectGraph } from '../core/projectGraph.js'
import { openModalCard, setModalDismissHook } from '../core/Modal.js'
import {
  bindModalChoiceScrollPersistence,
  captureModalChoiceScroll,
  restoreModalChoiceScroll
} from '../core/modalChoiceScroll.js'
import {
  normalizeAnimationTargetIntents,
  sendAnimationTargetIntentsPatch
} from './animationTargetIntents.js'

/**
 * Multi-toggle modal: assign which project intents an animation drives.
 * @param {string} animationGuid
 * @param {Record<string, unknown>} record
 * @returns {Promise<void>}
 */
export async function openAnimationTargetsPicker (animationGuid, record) {
  const initial = new Set(normalizeAnimationTargetIntents(record))
  /** @type {Set<string>} */
  const pending = new Set(initial)

  const intentRows = []
  for (const [guid, row] of projectGraph.getIntents()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const name =
      typeof row.name === 'string' && row.name.trim().length > 0
        ? row.name.trim()
        : guid
    intentRows.push({ guid, name })
  }
  intentRows.sort((a, b) => a.name.localeCompare(b.name))

  await openModalCard(dismiss => {
    /** @type {HTMLElement | null} */
    let scrollEl = null
    /** @type {(() => void) | null} */
    let unbindScroll = null
    const teardownScroll = () => {
      if (scrollEl) {
        captureModalChoiceScroll(scrollEl, 'animate.target-intents')
      }
      unbindScroll?.()
      unbindScroll = null
    }
    const finish = (/** @type {boolean} */ committed) => {
      setModalDismissHook(null)
      teardownScroll()
      if (committed) {
        sendAnimationTargetIntentsPatch(animationGuid, [...pending])
        record.targetIntents = [...pending]
        delete record.targetIntent
        delete record.intent
      }
      dismiss(committed ? true : null)
    }

    const card = document.createElement('div')
    card.className =
      'modal input-assign-modal input-assign-modal--assign-picker'
    card.addEventListener('click', e => e.stopPropagation())

    const heading = document.createElement('p')
    heading.className = 'modal-text'
    heading.textContent = 'Target intents'

    const listHost = document.createElement('div')
    scrollEl = listHost
    listHost.className = 'modal-choice-list input-assign-modal__assign-scroll'

    /** @param {HTMLElement} rowEl @param {boolean} isOn */
    const paintRow = (rowEl, isOn) => {
      const mainBtn = rowEl.querySelector('.animate-targets-toggle-main')
      if (mainBtn instanceof HTMLElement) {
        mainBtn.classList.toggle('modal-choice-list__btn--selected', isOn)
        mainBtn.setAttribute('aria-pressed', isOn ? 'true' : 'false')
      }
    }

    for (const row of intentRows) {
      const wrap = document.createElement('div')
      wrap.className = 'modal-choice-list__row'
      wrap.style.display = 'flex'
      wrap.style.alignItems = 'center'
      wrap.style.gap = '8px'

      const mainBtn = document.createElement('button')
      mainBtn.type = 'button'
      mainBtn.className =
        'btn modal-choice-list__btn animate-targets-toggle-main'
      mainBtn.style.flex = '1 1 auto'
      mainBtn.textContent = row.name
      mainBtn.title = row.guid
      mainBtn.addEventListener('click', () => {
        if (pending.has(row.guid)) pending.delete(row.guid)
        else pending.add(row.guid)
        paintRow(wrap, pending.has(row.guid))
      })

      wrap.appendChild(mainBtn)
      listHost.appendChild(wrap)
      paintRow(wrap, pending.has(row.guid))
    }

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
    card.appendChild(listHost)
    card.appendChild(footer)

    setModalDismissHook(() => {
      captureModalChoiceScroll(listHost, 'animate.target-intents')
      teardownScroll()
    })
    unbindScroll = bindModalChoiceScrollPersistence(
      listHost,
      'animate.target-intents'
    )

    requestAnimationFrame(() => {
      restoreModalChoiceScroll(listHost, 'animate.target-intents')
      okBtn.focus({ preventScroll: true })
    })

    return card
  })
}
