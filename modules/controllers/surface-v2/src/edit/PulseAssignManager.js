import { projectGraph } from '../core/projectGraph.js'
import {
  confirm as modalConfirm,
  openModalCard,
  prompt as modalPrompt,
  setModalDismissHook
} from '../core/Modal.js'
import {
  bindModalChoiceScrollPersistence,
  captureModalChoiceScroll,
  restoreModalChoiceScroll
} from '../core/modalChoiceScroll.js'
import {
  sendActionInputCommand,
  sendPulseAssignCommand
} from '../core/outboundQueue.js'
import { formatLinkedAssignLabel } from './assign/assignInlineLabel.js'
import { notification } from '../app/notification.js'
import {
  applyActionSelection,
  createEmptyActionSelectionState,
  renderActionParams
} from './actionEdit/actionParamsFactory.js'
import {
  buildAnimationExecutePatch,
  canEmitAnimationActionPatch
} from './actionEdit/animationActionParams.js'
import { destroyIntentParamWidgets } from './actionEdit/intentActionParams.js'

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
    if (!this._isSupportedContext() || !this._contextGuid) return

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
    if (modalOutcome.kind === 'delete' && typeof modalOutcome.bucketGuid === 'string') {
      const deleted = await this._confirmAndDeleteBucket(modalOutcome.bucketGuid)
      if (deleted) {
        await this._waitForBucketRemovedFromGraph(modalOutcome.bucketGuid)
      }
      await this.showControl()
      return
    }
    if (modalOutcome.kind === 'edit' && typeof modalOutcome.bucketGuid === 'string') {
      await this._editBucketByGuid(modalOutcome.bucketGuid)
      await this.showControl()
      return
    }
  }

  /**
   * @returns {string[]}
   */
  _collectLinkedBucketDisplayNames () {
    const names = []
    const linkedBuckets =
      this._contextType === 'scene'
        ? projectGraph.getBucketsLinkedToScene(this._contextGuid)
        : projectGraph.getBucketsLinkedToAnimation(this._contextGuid)
    for (const bucket of linkedBuckets) {
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
   * @returns {Promise<{ kind: 'done' | 'create' | 'delete' | 'edit', bucketGuid?: string } | null>}
   */
  _openAssignBucketsModal (bucketRows) {
    return openModalCard(dismiss => {
      /** @type {HTMLElement | null} */
      let assignScrollEl = null
      /** @type {(() => void) | null} */
      let unbindAssignScroll = null
      const teardownAssignScroll = () => {
        if (assignScrollEl) {
          captureModalChoiceScroll(assignScrollEl, 'pulse-assign.assign-picker')
        }
        unbindAssignScroll?.()
        unbindAssignScroll = null
      }
      const finish = (
        /** @type {Parameters<typeof dismiss>[0]} */ value
      ) => {
        setModalDismissHook(null)
        teardownAssignScroll()
        dismiss(value)
      }

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
          const isLinked =
            this._contextType === 'scene'
              ? projectGraph.bucketLinksScene(b, this._contextGuid)
              : projectGraph.bucketLinksAnimation(b, this._contextGuid)
          if (b.guid === row.guid && isLinked) {
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

        const editBtn = document.createElement('button')
        editBtn.type = 'button'
        editBtn.className =
          'input-assign-inline-icon-btn input-assign-inline-icon-btn--edit'
        editBtn.style.flex = '0 0 auto'
        editBtn.textContent = '✎'
        editBtn.setAttribute('aria-label', 'Edit')
        editBtn.addEventListener('click', e => {
          e.stopPropagation()
          finish({ kind: 'edit', bucketGuid: row.guid })
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
          finish({ kind: 'delete', bucketGuid: row.guid })
        })

        wrap.appendChild(mainBtn)
        wrap.appendChild(editBtn)
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
      createBtn.addEventListener('click', () => finish({ kind: 'create' }))
      createRowEl.appendChild(createBtn)

      const footer = document.createElement('div')
      footer.className = 'modal-actions'
      const okBtn = document.createElement('button')
      okBtn.type = 'button'
      okBtn.className = 'btn btn--primary'
      okBtn.textContent = 'OK'
      okBtn.addEventListener('click', () => {
        this._applyAssignmentPendingSets(initialLinked, pending)
        finish({ kind: 'done' })
      })
      footer.appendChild(okBtn)

      const scrollBody = document.createElement('div')
      scrollBody.className = 'input-assign-modal__assign-scroll'
      scrollBody.appendChild(listEl)
      scrollBody.appendChild(createRowEl)

      assignScrollEl = scrollBody
      unbindAssignScroll = bindModalChoiceScrollPersistence(
        scrollBody,
        'pulse-assign.assign-picker'
      )
      restoreModalChoiceScroll(scrollBody, 'pulse-assign.assign-picker')
      setModalDismissHook(teardownAssignScroll)

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
    const targetGuid = this._contextGuid
    const toUnlink = [...initialLinked].filter(g => !pending.has(g))
    const toLink = [...pending].filter(g => !initialLinked.has(g))
    for (const bg of toUnlink) {
      sendPulseAssignCommand(
        this._contextType === 'scene'
          ? {
              command: 'unlinkSceneFromBucket',
              bucketGuid: bg,
              sceneGuid: targetGuid
            }
          : {
              command: 'unlinkAnimationFromBucket',
              bucketGuid: bg,
              animationGuid: targetGuid
            }
      )
    }
    for (const bg of toLink) {
      if (this._contextType === 'scene') {
        const displaced = projectGraph.getOtherSceneDisplayNamesInBucket(
          bg,
          targetGuid
        )
        if (displaced.length > 0) {
          const bucket = [...projectGraph.getPulseBuckets()].find(
            b => b.guid === bg
          )
          const bucketLabel =
            typeof bucket?.name === 'string' && bucket.name.trim().length > 0
              ? bucket.name.trim()
              : bg
          const list = displaced.join(', ')
          const plural = displaced.length > 1 ? 'scenes' : 'scene'
          notification.warn(
            `Bucket "${bucketLabel}" allows one scene only — removed ${plural}: ${list}.`,
            `pulse-bucket-one-scene-${bg}`
          )
        }
        sendPulseAssignCommand({
          command: 'linkSceneToBucket',
          bucketGuid: bg,
          sceneGuid: targetGuid
        })
        continue
      }
      sendPulseAssignCommand({
        command: 'linkAnimationToBucket',
        bucketGuid: bg,
        animationGuid: targetGuid
      })
    }
  }

  _assignTargetHeadline () {
    const name =
      typeof this._labelDefault === 'string' && this._labelDefault.trim().length > 0
        ? this._labelDefault.trim()
        : this._contextGuid
    const kind = this._contextType === 'scene' ? 'Scene' : 'Animation'
    return `${kind} ${name}`.trim()
  }

  _isSupportedContext () {
    return this._contextType === 'animation' || this._contextType === 'scene'
  }

  /**
   * @param {string} bucketGuid
   */
  async _editBucketByGuid (bucketGuid) {
    const bucket = [...projectGraph.getPulseBuckets()].find(
      b => typeof b.guid === 'string' && b.guid === bucketGuid
    )
    if (!bucket) return
    const initialName =
      typeof bucket.name === 'string' && bucket.name.trim().length > 0
        ? bucket.name.trim()
        : bucketGuid

    const animationGuid = this._contextGuid
    const actionGuid =
      this._contextType === 'animation'
        ? projectGraph.getPulseBucketAnimationActionGuid(bucketGuid, animationGuid)
        : ''

    await openModalCard(dismiss => {
      const card = document.createElement('div')
      card.className = 'modal input-assign-modal pulse-assign-modal'
      card.addEventListener('click', e => e.stopPropagation())

      const title = document.createElement('p')
      title.className = 'modal-text'
      title.textContent = 'Edit pulse bucket'

      const nameLabel = document.createElement('label')
      nameLabel.className = 'input-assign-modal__label'
      nameLabel.textContent = 'Name'
      const nameInput = document.createElement('input')
      nameInput.type = 'text'
      nameInput.className = 'modal-input'
      nameInput.placeholder = 'bucket name'
      nameInput.value = initialName
      nameLabel.appendChild(nameInput)

      const errorEl = document.createElement('p')
      errorEl.className = 'input-assign-modal__error'
      errorEl.hidden = true

      /** @type {ReturnType<typeof createEmptyActionSelectionState> | null} */
      let state = null
      const paramHost = document.createElement('div')
      paramHost.className = 'input-assign-modal__param-host'

      if (this._contextType === 'animation' && actionGuid.length > 0) {
        state = createEmptyActionSelectionState()
        applyActionSelection(state, [actionGuid])

        const animRec = projectGraph.getAnimations().get(animationGuid)
        let animName = animationGuid
        if (animRec && typeof animRec === 'object' && !Array.isArray(animRec)) {
          const n = /** @type {Record<string, unknown>} */ (animRec).name
          if (typeof n === 'string' && n.trim().length > 0) animName = n.trim()
        }
        const pulseLine = document.createElement('p')
        pulseLine.className = 'modal-text'
        pulseLine.textContent = `Pulse: ${initialName} → ${animName}`

        const isAnimTarget =
          state.activeExecuteType === 'animation' &&
          state.animationActionGuidForParams.length > 0
        const needsManualNote = isAnimTarget && !state.hasAnimationCommands
        let note = null
        if (needsManualNote) {
          note = document.createElement('p')
          note.className = 'modal-text pulse-assign-anim-params-note'
          note.textContent =
            'This animation uses auto run mode. Command parameters only apply when the animation is set to manual run mode in the graph.'
        }

        renderActionParams(paramHost, state, {
          idPrefix: `pulse-bucket-${bucketGuid}`,
          typeClass: '',
          inputTypes: [],
          intentParamBinding: null
        })

        card.appendChild(title)
        card.appendChild(nameLabel)
        card.appendChild(errorEl)
        card.appendChild(pulseLine)
        if (note) {
          card.appendChild(note)
        }
        card.appendChild(paramHost)
      } else {
        if (this._contextType === 'animation' && actionGuid.length === 0) {
          const hint = document.createElement('p')
          hint.className = 'input-assign-modal__hint'
          hint.textContent =
            'Link this bucket to the animation (OK in the assign list) to configure animation parameters.'
          card.appendChild(title)
          card.appendChild(nameLabel)
          card.appendChild(errorEl)
          card.appendChild(hint)
        } else {
          card.appendChild(title)
          card.appendChild(nameLabel)
          card.appendChild(errorEl)
        }
      }

      const actions = document.createElement('div')
      actions.className = 'modal-actions'
      const cancelBtn = document.createElement('button')
      cancelBtn.type = 'button'
      cancelBtn.className = 'btn'
      cancelBtn.textContent = 'Cancel'
      cancelBtn.addEventListener('click', () => {
        destroyIntentParamWidgets()
        dismiss(null)
      })
      const saveBtn = document.createElement('button')
      saveBtn.type = 'button'
      saveBtn.className = 'btn btn--primary'
      saveBtn.textContent = 'Save'
      saveBtn.addEventListener('click', () => {
        errorEl.hidden = true
        const nameTrim = nameInput.value.trim()
        if (!nameTrim) {
          errorEl.textContent = 'Name is required.'
          errorEl.hidden = false
          return
        }
        void (async () => {
          if (nameTrim !== initialName) {
            sendPulseAssignCommand({
              command: 'renameBucket',
              bucketGuid,
              name: nameTrim
            })
            await this._waitForBucketName(bucketGuid, nameTrim)
          }
          if (state && canEmitAnimationActionPatch(state)) {
            const animPatch = buildAnimationExecutePatch(state)
            if (animPatch) {
              sendActionInputCommand({
                command: 'updateAction',
                actionGuid,
                patch: { execute: animPatch }
              })
            }
          }
          destroyIntentParamWidgets()
          dismiss(true)
        })()
      })

      actions.appendChild(cancelBtn)
      actions.appendChild(saveBtn)
      card.appendChild(actions)

      requestAnimationFrame(() => nameInput.focus())

      return card
    })
  }

  _bucketLinksTarget (bucket) {
    return this._contextType === 'scene'
      ? projectGraph.bucketLinksScene(bucket, this._contextGuid)
      : projectGraph.bucketLinksAnimation(bucket, this._contextGuid)
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
    sendPulseAssignCommand(
      this._contextType === 'scene'
        ? {
            command: 'createSceneBucketAssignment',
            sceneGuid: this._contextGuid,
            name
          }
        : {
            command: 'createBucketAssignment',
            animationGuid: this._contextGuid,
            name
          }
    )
    return name
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
        if (this._bucketLinksTarget(bucket)) return true
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
