import { projectGraph } from '../core/projectGraph.js'
import {
  confirm as modalConfirm,
  openModalCard,
  prompt as modalPrompt
} from '../core/Modal.js'
import { sendPulseAssignCommand } from '../core/outboundQueue.js'
import { formatLinkedAssignLabel } from './assign/assignInlineLabel.js'

export class PulseAssignManager {
  /**
   * @param {{ context: { type: string, guid: string }, labelDefault?: string }} opts
   */
  constructor (opts) {
    const ctx = opts.context
    this._contextType = String(ctx?.type ?? '')
    this._contextGuid = String(ctx?.guid ?? '')
    this._labelDefault = String(opts.labelDefault ?? this._contextGuid)
  }

  /**
   * @param {{ rowClass?: string, toggleClass?: string }} [opts]
   * @returns {HTMLElement}
   */
  getInlinePane (opts = {}) {
    const rowClass = opts.rowClass ?? 'pulse-assign-inline-row'
    const toggleClass = opts.toggleClass ?? 'intent-toggle'
    const rowEl = document.createElement('div')
    const toggle = document.createElement('button')
    toggle.type = 'button'

    const sync = () => {
      const linkedNames = this._collectLinkedBucketDisplayNames()
      const isActive = linkedNames.length > 0
      rowEl.className = isActive
        ? `${rowClass} ${rowClass}--active`.trim()
        : rowClass
      toggle.className = isActive
        ? `${toggleClass} intent-toggle--enabled`.trim()
        : toggleClass
      if (isActive) {
        const fullLabel = linkedNames.join(', ')
        toggle.textContent = formatLinkedAssignLabel(linkedNames)
        toggle.title = `Pulse buckets: ${fullLabel}`
      } else {
        toggle.textContent = 'Pulse'
        toggle.title = 'Assign pulse buckets'
      }
    }

    sync()

    toggle.addEventListener('click', () => {
      void this.showControl()
    })

    rowEl.appendChild(toggle)
    return rowEl
  }

  async showControl () {
    if (this._contextType !== 'animation' || !this._contextGuid) return

    const bucketRows = this._collectBucketRows()
    const modalOutcome = await this._openAssignBucketsModal(bucketRows)
    if (modalOutcome === null) return
    if (modalOutcome.kind === 'done') return
    if (modalOutcome.kind === 'create') {
      const createdName = await this._createBucketAndAssign()
      if (createdName) {
        await this._waitForBucketLinkedToAnimationByName(createdName)
      }
      await this.showControl()
      return
    }
    if (modalOutcome.kind === 'rename' && typeof modalOutcome.bucketGuid === 'string') {
      await this._renameBucket(modalOutcome.bucketGuid)
      await this.showControl()
      return
    }
    if (modalOutcome.kind === 'delete' && typeof modalOutcome.bucketGuid === 'string') {
      const deleted = await this._confirmAndDeleteBucket(modalOutcome.bucketGuid)
      if (deleted) {
        await this._waitForBucketRemovedFromGraph(modalOutcome.bucketGuid)
      }
      await this.showControl()
      return
    }
  }

  /**
   * @returns {string[]}
   */
  _collectLinkedBucketDisplayNames () {
    const names = []
    for (const bucket of projectGraph.getBucketsLinkedToAnimation(this._contextGuid)) {
      const rawName = bucket.name
      const name =
        typeof rawName === 'string' && rawName.trim().length > 0
          ? rawName.trim()
          : typeof bucket.guid === 'string'
            ? bucket.guid
            : ''
      if (name.length > 0) names.push(name)
    }
    return names.sort((a, b) => a.localeCompare(b))
  }

  /** @returns {Array<{ guid: string, name: string }>} */
  _collectBucketRows () {
    return [...projectGraph.getPulseBuckets()]
      .map(bucket => {
        const guid = typeof bucket.guid === 'string' ? bucket.guid : ''
        if (!guid) return null
        const name =
          typeof bucket.name === 'string' && bucket.name.trim().length > 0
            ? bucket.name.trim()
            : guid
        return { guid, name }
      })
      .filter(
        /** @returns {row is { guid: string, name: string }} */ row => row !== null
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * @param {Array<{ guid: string, name: string }>} bucketRows
   * @returns {Promise<{ kind: string, bucketGuid?: string } | null>}
   */
  _openAssignBucketsModal (bucketRows) {
    return openModalCard(dismiss => {
      const card = document.createElement('div')
      card.className =
        'modal input-assign-modal pulse-assign-modal input-assign-modal--assign-picker'
      card.addEventListener('click', e => e.stopPropagation())

      const heading = document.createElement('p')
      heading.className = 'modal-text'
      heading.textContent = `Pulse for ${this._assignTargetHeadline()}`

      const listEl = document.createElement('div')
      listEl.className = 'modal-choice-list'

      /** @type {Set<string>} */
      const initialLinked = new Set()
      for (const row of bucketRows) {
        for (const b of projectGraph.getPulseBuckets()) {
          if (b.guid === row.guid && projectGraph.bucketLinksAnimation(b, this._contextGuid)) {
            initialLinked.add(row.guid)
            break
          }
        }
      }
      /** @type {Set<string>} */
      const pending = new Set(initialLinked)

      /** @param {HTMLElement} rowEl @param {boolean} isOn */
      const paintRow = (rowEl, isOn) => {
        const mainBtn = rowEl.querySelector('.pulse-assign-toggle-main')
        if (mainBtn instanceof HTMLElement) {
          mainBtn.classList.toggle('modal-choice-list__btn--selected', isOn)
          mainBtn.setAttribute('aria-pressed', isOn ? 'true' : 'false')
        }
      }

      for (const row of bucketRows) {
        const wrap = document.createElement('div')
        wrap.className = 'modal-choice-list__row pulse-assign-toggle-row'
        wrap.style.display = 'flex'
        wrap.style.alignItems = 'center'
        wrap.style.gap = '8px'
        wrap.style.flexWrap = 'nowrap'

        const mainBtn = document.createElement('button')
        mainBtn.type = 'button'
        mainBtn.className =
          'btn modal-choice-list__btn pulse-assign-toggle-main'
        mainBtn.style.flex = '1 1 auto'
        mainBtn.style.width = 'auto'
        mainBtn.textContent = row.name
        mainBtn.addEventListener('click', () => {
          if (pending.has(row.guid)) pending.delete(row.guid)
          else pending.add(row.guid)
          paintRow(wrap, pending.has(row.guid))
        })

        const renameBtn = document.createElement('button')
        renameBtn.type = 'button'
        renameBtn.className =
          'input-assign-inline-icon-btn input-assign-inline-icon-btn--edit'
        renameBtn.style.flex = '0 0 auto'
        renameBtn.textContent = '✎'
        renameBtn.setAttribute('aria-label', 'Rename')
        renameBtn.addEventListener('click', e => {
          e.stopPropagation()
          dismiss({ kind: 'rename', bucketGuid: row.guid })
        })

        const deleteBtn = document.createElement('button')
        deleteBtn.type = 'button'
        deleteBtn.className =
          'input-assign-inline-icon-btn input-assign-inline-icon-btn--delete'
        deleteBtn.style.flex = '0 0 auto'
        deleteBtn.textContent = '❌'
        deleteBtn.setAttribute('aria-label', 'Delete')
        deleteBtn.addEventListener('click', e => {
          e.stopPropagation()
          dismiss({ kind: 'delete', bucketGuid: row.guid })
        })

        wrap.appendChild(mainBtn)
        wrap.appendChild(renameBtn)
        wrap.appendChild(deleteBtn)
        listEl.appendChild(wrap)
        paintRow(wrap, pending.has(row.guid))
      }

      const createRowEl = document.createElement('div')
      createRowEl.className = 'modal-choice-list__row'
      const createBtn = document.createElement('button')
      createBtn.type = 'button'
      createBtn.className = 'btn modal-choice-list__btn'
      createBtn.textContent = 'Create new bucket'
      createBtn.addEventListener('click', () => dismiss({ kind: 'create' }))
      createRowEl.appendChild(createBtn)

      const footer = document.createElement('div')
      footer.className = 'modal-actions'
      const okBtn = document.createElement('button')
      okBtn.type = 'button'
      okBtn.className = 'btn btn--primary'
      okBtn.textContent = 'OK'
      okBtn.addEventListener('click', () => {
        this._applyAssignmentPendingSets(initialLinked, pending)
        dismiss({ kind: 'done' })
      })
      footer.appendChild(okBtn)

      const scrollBody = document.createElement('div')
      scrollBody.className = 'input-assign-modal__assign-scroll'
      scrollBody.appendChild(listEl)
      scrollBody.appendChild(createRowEl)

      card.appendChild(heading)
      card.appendChild(scrollBody)
      card.appendChild(footer)
      return card
    })
  }

  /**
   * @param {Set<string>} initialLinked
   * @param {Set<string>} pending
   */
  _applyAssignmentPendingSets (initialLinked, pending) {
    const animationGuid = this._contextGuid
    const toUnlink = [...initialLinked].filter(g => !pending.has(g))
    const toLink = [...pending].filter(g => !initialLinked.has(g))
    for (const bg of toUnlink) {
      sendPulseAssignCommand({
        command: 'unlinkAnimationFromBucket',
        bucketGuid: bg,
        animationGuid
      })
    }
    for (const bg of toLink) {
      sendPulseAssignCommand({
        command: 'linkAnimationToBucket',
        bucketGuid: bg,
        animationGuid
      })
    }
  }

  _assignTargetHeadline () {
    const name =
      typeof this._labelDefault === 'string' && this._labelDefault.trim().length > 0
        ? this._labelDefault.trim()
        : this._contextGuid
    return `Animation ${name}`.trim()
  }

  /** @returns {Promise<string | null>} */
  async _createBucketAndAssign () {
    const values = await modalPrompt(
      '',
      [
        {
          label: 'Name',
          key: 'name',
          value: this._labelDefault,
          placeholder: 'bucket name'
        }
      ],
      { submit: 'Create' }
    )
    const name = values?.name?.trim()
    if (!name) return null
    sendPulseAssignCommand({
      command: 'createBucketAssignment',
      animationGuid: this._contextGuid,
      name
    })
    return name
  }

  /** @param {string} bucketGuid */
  async _renameBucket (bucketGuid) {
    const bucket = [...projectGraph.getPulseBuckets()].find(b => b.guid === bucketGuid)
    if (!bucket) return
    const current =
      typeof bucket.name === 'string' && bucket.name.trim().length > 0
        ? bucket.name.trim()
        : bucketGuid
    const values = await modalPrompt(
      'Rename bucket',
      [{ label: 'Name', key: 'name', value: current }],
      { submit: 'Save' }
    )
    const name = values?.name?.trim()
    if (!name || name === current) return
    sendPulseAssignCommand({
      command: 'renameBucket',
      bucketGuid,
      name
    })
    await this._waitForBucketName(bucketGuid, name)
  }

  /**
   * @param {string} bucketGuid
   * @returns {Promise<boolean>}
   */
  async _confirmAndDeleteBucket (bucketGuid) {
    const bucket = [...projectGraph.getPulseBuckets()].find(b => b.guid === bucketGuid)
    const label =
      typeof bucket?.name === 'string' && bucket.name.trim().length > 0
        ? bucket.name.trim()
        : bucketGuid
    const ok = await modalConfirm(`Delete pulse bucket "${label}"?`, {
      yes: 'Delete',
      no: 'Cancel'
    })
    if (!ok) return false
    sendPulseAssignCommand({ command: 'deleteBucket', bucketGuid })
    return true
  }

  /** @param {string} bucketGuid */
  async _waitForBucketRemovedFromGraph (bucketGuid) {
    if (!bucketGuid) return
    const matches = () =>
      ![...projectGraph.getPulseBuckets()].some(b => b.guid === bucketGuid)
    if (matches()) return
    await this._waitForGraphTopics(['pulses', 'actions'], matches)
  }

  /** @param {string} bucketName */
  async _waitForBucketLinkedToAnimationByName (bucketName) {
    const expected = bucketName.trim()
    if (!expected) return
    const matches = () => {
      for (const bucket of projectGraph.getPulseBuckets()) {
        const name =
          typeof bucket.name === 'string' && bucket.name.trim().length > 0
            ? bucket.name.trim()
            : ''
        if (name !== expected) continue
        if (projectGraph.bucketLinksAnimation(bucket, this._contextGuid)) return true
      }
      return false
    }
    if (matches()) return
    await this._waitForGraphTopics(['pulses', 'actions'], matches)
  }

  /**
   * @param {string} bucketGuid
   * @param {string} expectedName
   */
  async _waitForBucketName (bucketGuid, expectedName) {
    const expected = expectedName.trim()
    const matches = () => {
      const bucket = [...projectGraph.getPulseBuckets()].find(b => b.guid === bucketGuid)
      return (
        typeof bucket?.name === 'string' && bucket.name.trim() === expected
      )
    }
    if (matches()) return
    await this._waitForGraphTopics(['pulses'], matches)
  }

  /**
   * @param {string[]} topics
   * @param {() => boolean} matches
   */
  async _waitForGraphTopics (topics, matches) {
    await new Promise(resolve => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        window.clearTimeout(tid)
        unsub()
        resolve()
      }
      const unsub = projectGraph.subscribe(topics, () => {
        if (matches()) finish()
      })
      const tid = window.setTimeout(finish, 2500)
      queueMicrotask(() => {
        if (matches()) finish()
      })
    })
  }
}
