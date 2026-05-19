import { projectGraph } from '../core/projectGraph.js'
import { getCapabilities } from '../core/systemCapabilities.js'
import { sendGraphCommand } from '../core/outboundQueue.js'
import { readAtDotPath } from '../core/dotPath.js'
import { getAnimatorViewer } from './animators/animatorViewerRegistry.js'
import { ScalarRadialKnobSvg } from '../edit/components/ScalarRadialKnobSvg.js'
import { SelectPopup } from '../edit/components/selectPopup.js'
import * as Modal from '../core/Modal.js'
import { InputAssignManager } from '../edit/InputAssignManager.js'
import { PulseAssignManager } from '../edit/PulseAssignManager.js'
import {
  formatAnimationTargetsSummary,
  formatAnimationTargetsTitle,
  normalizeAnimationTargetIntents
} from './animationTargetIntents.js'
import { openAnimationTargetsPicker } from './performAnimateTargetsPicker.js'

/**
 * Reads `systemCapabilities.animationCommonProperties.runmode` on each call so
 * options exist after capabilities arrive (the pane is created before register finishes).
 * @returns {{ options: string[], defaultValue: string }}
 */
function readAnimationRunmodeCaps () {
  const caps = getCapabilities()
  const commonCaps =
    caps && !Array.isArray(caps.animationCommonProperties)
      ? caps.animationCommonProperties
      : null
  const runmodeRaw =
    commonCaps &&
    typeof commonCaps === 'object' &&
    !Array.isArray(commonCaps)
      ? /** @type {Record<string, unknown>} */ (commonCaps).runmode
      : null
  const runmodeDescriptor =
    runmodeRaw &&
    typeof runmodeRaw === 'object' &&
    !Array.isArray(runmodeRaw)
      ? /** @type {Record<string, unknown>} */ (runmodeRaw)
      : null
  let options = []
  if (runmodeDescriptor && Array.isArray(runmodeDescriptor.options)) {
    options = runmodeDescriptor.options.filter(
      opt => typeof opt === 'string' && opt.length > 0
    )
  }
  if (options.length === 0) {
    options = ['auto', 'manual']
  }
  const yamlDefault =
    runmodeDescriptor && typeof runmodeDescriptor.defaultValue === 'string'
      ? runmodeDescriptor.defaultValue.trim()
      : ''
  const defaultValue =
    yamlDefault.length > 0 && options.includes(yamlDefault)
      ? yamlDefault
      : typeof options[0] === 'string'
        ? options[0]
        : 'auto'
  return { options, defaultValue }
}

/**
 * Edit pane for a single animation record.
 * Positioned absolute over the full pane-host (covers subnav).
 * Top row: back | runmode + name | input assign | target intents | delete.
 * Body: content fields from systemCapabilities display.
 *
 * @param {{ onClose: () => void }} opts
 * @returns {{ el: HTMLElement, open: (record: Record<string, unknown>) => void }}
 */
export function createAnimationEditPane ({ onClose }) {
  const el = document.createElement('div')
  el.className = 'perform-animate-edit'
  el.hidden = true

  // ── top row: back | name | intent ──────────────────────────────────────────

  const topRow = document.createElement('div')
  topRow.className = 'perform-animate-edit__top'

  const backBtn = document.createElement('button')
  backBtn.type = 'button'
  backBtn.className = 'perform-animate-edit__back'
  backBtn.textContent = '←'
  backBtn.addEventListener('click', () => {
    el.hidden = true
    onClose()
  })

  const nameCluster = document.createElement('div')
  nameCluster.className = 'perform-animate-edit__name-cluster'

  const runmodeBtn = document.createElement('button')
  runmodeBtn.type = 'button'
  runmodeBtn.className = 'perform-animate-edit__runmode'
  runmodeBtn.title = 'Run mode'

  const nameLabel = document.createElement('button')
  nameLabel.type = 'button'
  nameLabel.className = 'perform-animate-edit__name'
  nameLabel.title = 'Edit animation name'

  nameCluster.appendChild(runmodeBtn)
  nameCluster.appendChild(nameLabel)

  const assignHost = document.createElement('div')
  assignHost.className = 'perform-animate-edit__assign'

  const targetsBtn = document.createElement('button')
  targetsBtn.type = 'button'
  targetsBtn.className = 'perform-animate-edit__targets btn'

  const deleteBtn = document.createElement('button')
  deleteBtn.type = 'button'
  deleteBtn.className = 'perform-animate-edit__delete btn--danger'
  deleteBtn.textContent = '❌'

  topRow.appendChild(backBtn)
  topRow.appendChild(nameCluster)
  topRow.appendChild(assignHost)
  topRow.appendChild(targetsBtn)
  topRow.appendChild(deleteBtn)

  // ── body: content fields ───────────────────────────────────────────────────

  const body = document.createElement('div')
  body.className = 'perform-animate-edit__body'

  el.appendChild(topRow)
  el.appendChild(body)

  /** @type {string} */
  let currentGuid = ''

  /** @type {Record<string, unknown> | null} */
  let lastOpenRecord = null

  /** @param {unknown} opt */
  function runmodeDisplayLabel (opt) {
    const { defaultValue } = readAnimationRunmodeCaps()
    const s = typeof opt === 'string' && opt.length > 0 ? opt : defaultValue
    return s.charAt(0).toUpperCase() + s.slice(1)
  }

  /** @param {Record<string, unknown> | null | undefined} record */
  function resolveRunmode (record) {
    const { options, defaultValue } = readAnimationRunmodeCaps()
    const raw = record?.runmode
    const fromRecord = typeof raw === 'string' && raw.length > 0 ? raw : ''
    if (fromRecord && options.includes(fromRecord)) return fromRecord
    return defaultValue
  }

  function applyRunmodeLabel () {
    if (!lastOpenRecord) return
    const rm = resolveRunmode(lastOpenRecord)
    runmodeBtn.textContent = runmodeDisplayLabel(rm)
    runmodeBtn.className = `perform-animate-edit__runmode perform-animate-edit__runmode--${rm}`
    runmodeBtn.title = `Run mode: ${runmodeDisplayLabel(rm)}`
  }

  function applyTargetsLabel () {
    if (!lastOpenRecord) return
    const guids = normalizeAnimationTargetIntents(lastOpenRecord)
    targetsBtn.textContent = formatAnimationTargetsSummary(guids, { maxNames: 2 })
    const title = formatAnimationTargetsTitle(guids)
    targetsBtn.title = title
    targetsBtn.setAttribute('aria-label', `Target intents: ${title}`)
  }

  function renderAssignRow () {
    if (!lastOpenRecord || !currentGuid) return
    assignHost.replaceChildren()
    const iam = new InputAssignManager({
      context: { type: 'animation', guid: currentGuid },
      labelDefault: String(lastOpenRecord.name ?? currentGuid)
    })
    assignHost.appendChild(
      iam.getInlinePane({
        rowClass: 'scene-perform-row',
        toggleClass: 'intent-toggle scene-perform-button'
      })
    )
    const pam = new PulseAssignManager({
      context: { type: 'animation', guid: currentGuid },
      labelDefault: String(lastOpenRecord.name ?? currentGuid)
    })
    assignHost.appendChild(
      pam.getInlinePane({
        rowClass: 'scene-perform-row',
        toggleClass: 'intent-toggle scene-perform-button'
      })
    )
  }

  projectGraph.subscribe(['actions', 'inputs', 'pulses', 'animations'], () => {
    if (!el.hidden && currentGuid && lastOpenRecord) {
      const row = projectGraph.getAnimations().get(currentGuid)
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        const rec = /** @type {Record<string, unknown>} */ (row)
        lastOpenRecord.runmode = rec.runmode
        if (Array.isArray(rec.targetIntents)) {
          lastOpenRecord.targetIntents = rec.targetIntents
        }
      }
      applyRunmodeLabel()
      applyTargetsLabel()
      renderAssignRow()
    }
  })

  projectGraph.subscribe(['intents:def'], () => {
    if (!el.hidden && lastOpenRecord) applyTargetsLabel()
  })

  targetsBtn.addEventListener('click', () => {
    if (!lastOpenRecord || !currentGuid) return
    void openAnimationTargetsPicker(currentGuid, lastOpenRecord).then(() => {
      applyTargetsLabel()
    })
  })

  /** @param {Record<string, unknown>} record */
  function open (record) {
    currentGuid = String(record.guid ?? '')
    lastOpenRecord = record

    nameLabel.textContent = String(record.name ?? '')
    nameLabel.onclick = async () => {
      const current = String(record.name ?? '')
      const result = await Modal.prompt('Edit animation name', [
        { label: 'Name', key: 'name', value: current }
      ])
      if (result === null) return
      const nextName = result.name ?? ''
      nameLabel.textContent = nextName
      sendAnimationPatch(currentGuid, { name: nextName })
      record.name = nextName
      renderAssignRow()
    }

    applyRunmodeLabel()
    runmodeBtn.onclick = async () => {
      const current = resolveRunmode(record)
      const { options } = readAnimationRunmodeCaps()
      const choice = await Modal.pickChoice(
        'Run mode',
        options.map(opt => ({
          value: opt,
          label: runmodeDisplayLabel(opt)
        })),
        { selected: current, scrollKey: 'animate.runmode' }
      )
      if (!choice || choice === current) return
      sendAnimationPatch(currentGuid, { runmode: choice })
      record.runmode = choice
      applyRunmodeLabel()
      renderAssignRow()
    }

    applyTargetsLabel()
    deleteBtn.onclick = async () => {
      const animationName = String(record.name ?? currentGuid)
      const ok = await Modal.confirm(`Delete animation "${animationName}"?`, {
        yes: 'Delete',
        no: 'Cancel'
      })
      if (!ok) return
      const guid = currentGuid
      sendGraphCommand({
        op: 'remove',
        entityType: 'animation',
        guid,
        persistence: 'runtimeAndDurable'
      })
      projectGraph.applyGraphDelta({
        entityType: 'animation',
        op: 'remove',
        guid
      })

      el.hidden = true
      onClose()
    }

    el.hidden = false
    renderAssignRow()
    renderBody(record)
  }

  /** @param {Record<string, unknown>} record */
  function renderBody (record) {
    body.replaceChildren()
    const paramsWrap = document.createElement('div')
    paramsWrap.className = 'perform-animate-edit__params'

    const guid = currentGuid
    const cls = String(record.class ?? '')
    const viewer = getAnimatorViewer(cls)
    const caps = getCapabilities()

    // content fields from systemCapabilities.animations[class].display
    const display = getClassDisplayMap(caps, cls)
    if (!display) return

    for (const [dotKey, displayConfig] of Object.entries(display)) {
      const value = readAtDotPath(
        /** @type {Record<string, unknown>} */ (record),
        dotKey
      )
      const descriptor = viewer?.getFieldDescriptor(dotKey) ?? null
      const label = descriptor?.name ?? dotKeyToLabel(dotKey)
      const hint = descriptor?.hint ?? null

      const customEl =
        viewer?.renderField(dotKey, value, newValue => {
          sendAnimationPatch(guid, { [dotKey]: newValue })
        }) ?? null

      const widgetType =
        displayConfig && typeof displayConfig === 'object'
          ? String(
              /** @type {Record<string, unknown>} */ (displayConfig).type ?? ''
            )
          : ''

      const widget =
        customEl ??
        makeGenericWidget(
          widgetType,
          value,
          descriptor,
          guid,
          dotKey,
          label,
          hint,
          newValue => {
            sendAnimationPatch(guid, { [dotKey]: newValue })
          }
        )

      paramsWrap.appendChild(makeFieldRow(label, null, widget))
    }

    body.appendChild(paramsWrap)

    const editSection = viewer?.renderEditSection?.(record)
    if (editSection) body.appendChild(editSection)
  }

  return { el, open }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** @param {string} guid @param {Record<string, unknown>} patch */
function sendAnimationPatch (guid, patch) {
  sendGraphCommand({
    op: 'upsert',
    entityType: 'animation',
    guid,
    patch,
    persistence: 'runtimeAndDurable'
  })
  // Hub filters the matching delta from its echo back to the source controller, so apply locally.
  projectGraph.applyGraphDelta({
    entityType: 'animation',
    op: 'upsert',
    guid,
    patch
  })
}

/**
 * @param {string} label
 * @param {string | null} hint
 * @param {HTMLElement} widget
 */
function makeFieldRow (label, hint, widget) {
  const row = document.createElement('div')
  row.className = 'perform-animate-field perform-animate-field--paramrow'

  const labelEl = document.createElement('div')
  labelEl.className = 'perform-animate-field__label'

  const nameSpan = document.createElement('span')
  nameSpan.className = 'perform-animate-field__label-name'
  nameSpan.textContent = label
  labelEl.appendChild(nameSpan)

  if (hint) {
    const hintSpan = document.createElement('span')
    hintSpan.className = 'perform-animate-field__hint'
    hintSpan.textContent = hint
    labelEl.appendChild(hintSpan)
  }

  row.appendChild(widget)
  row.appendChild(labelEl)
  return row
}

/**
 * @param {string} type
 * @param {unknown} value
 * @param {{ name?: string, hint?: string, range?: [number, number], step?: number, default?: number | string, options?: string[], optionsRef?: string, stepFunction?: string } | null} descriptor
 * @param {string} animationGuid
 * @param {string} dotKey
 * @param {string} label
 * @param {string | null} hint
 * @param {(value: unknown) => void} onChange
 */
function makeGenericWidget (
  type,
  value,
  descriptor,
  animationGuid,
  dotKey,
  label,
  hint,
  onChange
) {
  if (type === 'slider') {
    return makeRadialKnobWidget(
      value,
      descriptor,
      animationGuid,
      dotKey,
      label,
      hint,
      onChange
    )
  }
  if (type === 'select' || type === 'dropdown') {
    let options = descriptor?.options ?? null
    if (!options && descriptor?.optionsRef) {
      const caps = getCapabilities()
      const ref = caps?.[descriptor.optionsRef]
      if (Array.isArray(ref)) options = /** @type {string[]} */ (ref)
    }
    const list = options ?? []
    const effectiveValue = value ?? descriptor?.default ?? null
    const host = document.createElement('div')
    host.className = 'perform-animate-field__select-host'
    const popup = new SelectPopup({
      value: effectiveValue,
      options: list,
      onChange,
      ariaLabel: label,
      scrollKey: `animate.field.${dotKey}`
    })
    popup.mount(host)
    return host
  }
  return makeNumberInput(value, descriptor, onChange)
}

/**
 * @param {unknown} value
 * @param {{ range?: [number, number], step?: number, default?: number | string, stepFunction?: string } | null} descriptor
 * @param {string} animationGuid
 * @param {string} dotKey
 * @param {string} label
 * @param {string | null} hint
 * @param {(value: number) => void} onChange
 */
function makeRadialKnobWidget (
  value,
  descriptor,
  animationGuid,
  dotKey,
  label,
  hint,
  onChange
) {
  const min = descriptor?.range?.[0] ?? 0
  const max = descriptor?.range?.[1] ?? 100
  const fallback =
    typeof descriptor?.default === 'number' ? descriptor.default : min
  const initial =
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  let currentValue = initial

  const container = document.createElement('div')
  container.className = 'perform-animate-field__knob'

  const stepFnName =
    typeof descriptor?.stepFunction === 'string' &&
    descriptor.stepFunction.length > 0
      ? descriptor.stepFunction
      : null

  /** @type {Record<string, unknown>} */
  const knobDescriptor = {
    name: label,
    range: [min, max],
    step: descriptor?.step,
    defaultValue: fallback,
    dotKey
  }
  if (stepFnName) knobDescriptor.stepFunction = stepFnName

  const knob = new ScalarRadialKnobSvg({
    descriptor: knobDescriptor,
    intentGuid: animationGuid,
    readValue: () => currentValue,
    onCommit: domain => {
      currentValue = domain
      onChange(domain)
    },
    showInnerSvgTitle: false,
    hint: typeof hint === 'string' && hint.length > 0 ? hint : undefined
  })
  knob.mount(container)
  requestAnimationFrame(() => knob.syncFromExternal())
  return container
}

/**
 * @param {unknown} value
 * @param {{ range?: [number, number], step?: number, default?: number | string } | null} descriptor
 * @param {(value: number) => void} onChange
 */
function makeNumberInput (value, descriptor, onChange) {
  const input = document.createElement('input')
  input.type = 'number'
  input.className =
    'perform-animate-field__input perform-animate-field__input--number'
  const numDefault =
    typeof descriptor?.default === 'number' ? descriptor.default : undefined
  const numInitial = typeof value === 'number' ? value : numDefault
  input.value = numInitial !== undefined ? String(numInitial) : ''
  if (descriptor?.range) {
    input.min = String(descriptor.range[0])
    input.max = String(descriptor.range[1])
  }
  if (descriptor?.step !== undefined) input.step = String(descriptor.step)
  input.addEventListener('change', () => {
    const n = parseFloat(input.value)
    if (Number.isFinite(n)) onChange(n)
  })
  return input
}

/** @param {string} guid */
function resolveIntentName (guid) {
  if (!guid) return ''
  const intent = /** @type {Record<string, unknown> | undefined} */ (
    projectGraph.getIntents().get(guid)
  )
  const name = intent?.name
  return typeof name === 'string' && name ? name : guid
}

/** @param {Record<string, unknown> | null} caps @param {string} cls */
function getClassDisplayMap (caps, cls) {
  const list = caps?.animations
  if (!Array.isArray(list) || !cls) return null
  const entry = /** @type {Record<string, unknown> | undefined} */ (
    list.find(e => e.class === cls)
  )
  const display = entry?.display
  if (!display || typeof display !== 'object' || Array.isArray(display))
    return null
  return /** @type {Record<string, unknown>} */ (display)
}

function dotKeyToLabel (dotKey) {
  const last = dotKey.split('.').pop() ?? dotKey
  return last.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())
}
