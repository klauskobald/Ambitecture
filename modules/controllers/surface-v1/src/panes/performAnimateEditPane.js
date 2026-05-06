import { projectGraph } from '../core/projectGraph.js'
import { getCapabilities } from '../core/systemCapabilities.js'
import { sendGraphCommand } from '../core/outboundQueue.js'
import { readAtDotPath } from '../core/dotPath.js'
import { getAnimatorViewer } from './animators/animatorViewerRegistry.js'
import { ScalarDragSlider } from '../edit/components/ScalarDragSlider.js'
import { evaluate as fnEvaluate, inverse as fnInverse } from '../edit/controls/fnCurve.js'

/**
 * Edit pane for a single animation record.
 * Positioned absolute over the full pane-host (covers subnav).
 * Top row: back button | name input | target intent.
 * Body: class switcher (if > 1 class) + content fields from systemCapabilities display.
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

  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  nameInput.className = 'perform-animate-edit__name'
  nameInput.placeholder = 'Name'

  const intentSpan = document.createElement('span')
  intentSpan.className = 'perform-animate-edit__intent'

  topRow.appendChild(backBtn)
  topRow.appendChild(nameInput)
  topRow.appendChild(intentSpan)

  // ── body: class switcher + content fields ──────────────────────────────────

  const body = document.createElement('div')
  body.className = 'perform-animate-edit__body'

  el.appendChild(topRow)
  el.appendChild(body)

  /** @type {string} */
  let currentGuid = ''

  /** @param {Record<string, unknown>} record */
  function open (record) {
    currentGuid = String(record.guid ?? '')

    nameInput.value = String(record.name ?? '')
    nameInput.onchange = () => sendAnimationPatch(currentGuid, { name: nameInput.value })

    const intentGuid = String(record.targetIntent ?? record.intent ?? '')
    intentSpan.textContent = resolveIntentName(intentGuid)

    el.hidden = false
    renderBody(record)
  }

  /** @param {Record<string, unknown>} record */
  function renderBody (record) {
    body.replaceChildren()
    const guid = currentGuid
    const cls = String(record.class ?? '')
    const viewer = getAnimatorViewer(cls)
    const caps = getCapabilities()

    // class switcher — only when hub advertises ≥ 2 classes
    const animClasses = getAnimationClasses(caps)
    if (animClasses.length >= 2) {
      body.appendChild(makeFieldRow('Class', null,
        makeClassSelect(cls, animClasses, newClass => {
          const warn = viewer?.shouldWarnOnClassSwitch(record) ?? false
          if (warn && !confirm(`Switching to "${newClass}" will clear this animation's content. Continue?`)) return
          sendAnimationPatch(guid, { class: newClass, content: {} })
        })
      ))
    }

    // content fields from systemCapabilities.animations[class].display
    const display = getClassDisplayMap(caps, cls)
    if (display) {
      for (const [dotKey, displayConfig] of Object.entries(display)) {
        const value = readAtDotPath(/** @type {Record<string, unknown>} */ (record), dotKey)
        const descriptor = viewer?.getFieldDescriptor(dotKey) ?? null
        const label = descriptor?.name ?? dotKeyToLabel(dotKey)
        const hint = descriptor?.hint ?? null

        const customEl = viewer?.renderField(dotKey, value, newValue => {
          sendAnimationPatch(guid, { [dotKey]: newValue })
        }) ?? null

        if (customEl) {
          body.appendChild(makeFieldRow(label, hint, customEl))
          continue
        }

        const widgetType = displayConfig && typeof displayConfig === 'object'
          ? String(/** @type {Record<string, unknown>} */ (displayConfig).type ?? '')
          : ''
        body.appendChild(makeFieldRow(label, hint,
          makeGenericWidget(widgetType, value, descriptor, newValue => {
            sendAnimationPatch(guid, { [dotKey]: newValue })
          })
        ))
      }
    }
  }

  return { el, open }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** @param {string} guid @param {Record<string, unknown>} patch */
function sendAnimationPatch (guid, patch) {
  sendGraphCommand({ op: 'upsert', entityType: 'animation', guid, patch, persistence: 'runtimeAndDurable' })
}

/**
 * @param {string} label
 * @param {string | null} hint
 * @param {HTMLElement} widget
 */
function makeFieldRow (label, hint, widget) {
  const row = document.createElement('div')
  row.className = 'perform-animate-field'

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

  row.appendChild(labelEl)
  row.appendChild(widget)
  return row
}

/** @param {unknown} initialValue @param {(v: string) => void} onCommit */
function makeTextInput (initialValue, onCommit) {
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'perform-animate-field__input'
  input.value = typeof initialValue === 'string' ? initialValue : ''
  input.addEventListener('change', () => onCommit(input.value))
  return input
}

/** @param {string} text */
function makeReadOnly (text) {
  const span = document.createElement('span')
  span.className = 'perform-animate-field__readonly'
  span.textContent = text || '—'
  return span
}

/**
 * @param {string} current
 * @param {Array<{ cls: string, name: string }>} classes
 * @param {(cls: string) => void} onChange
 */
function makeClassSelect (current, classes, onChange) {
  const select = document.createElement('select')
  select.className = 'perform-animate-field__select'
  for (const { cls, name } of classes) {
    const opt = document.createElement('option')
    opt.value = cls
    opt.textContent = name
    if (cls === current) opt.selected = true
    select.appendChild(opt)
  }
  select.addEventListener('change', () => onChange(select.value))
  return select
}

/**
 * @param {string} type
 * @param {unknown} value
 * @param {{ name?: string, range?: [number, number], step?: number, default?: number | string, options?: string[], optionsRef?: string, stepFunction?: string } | null} descriptor
 * @param {(value: unknown) => void} onChange
 */
function makeGenericWidget (type, value, descriptor, onChange) {
  if (type === 'slider') {
    return makeSliderWidget(value, descriptor, onChange)
  }
  if (type === 'select' || type === 'dropdown') {
    let options = descriptor?.options ?? null
    if (!options && descriptor?.optionsRef) {
      const caps = getCapabilities()
      const ref = caps?.[descriptor.optionsRef]
      if (Array.isArray(ref)) options = /** @type {string[]} */ (ref)
    }
    const list = options ?? []
    const select = document.createElement('select')
    select.className = 'perform-animate-field__select'
    const effectiveValue = value ?? descriptor?.default ?? null
    for (const opt of list) {
      const o = document.createElement('option')
      o.value = String(opt)
      o.textContent = String(opt)
      if (opt === effectiveValue) o.selected = true
      select.appendChild(o)
    }
    select.addEventListener('change', () => onChange(select.value))
    return select
  }
  return makeNumberInput(value, descriptor, onChange)
}

/**
 * @param {unknown} value
 * @param {{ range?: [number, number], step?: number, default?: number | string, stepFunction?: string } | null} descriptor
 * @param {(value: number) => void} onChange
 */
function makeSliderWidget (value, descriptor, onChange) {
  const min = descriptor?.range?.[0] ?? 0
  const max = descriptor?.range?.[1] ?? 100
  const span = max - min
  const step = descriptor?.step
  const fallback = typeof descriptor?.default === 'number' ? descriptor.default : min
  const initial = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  const stepFnName = typeof descriptor?.stepFunction === 'string' && descriptor.stepFunction.length > 0
    ? descriptor.stepFunction : null

  const container = document.createElement('div')
  container.className = 'perform-animate-field__slider'

  /** @param {number} v */
  const snap = v => step
    ? Math.max(min, Math.min(max, Math.round((v - min) / step) * step + min))
    : Math.max(min, Math.min(max, v))

  const sliderOpts = stepFnName == null
    ? { min, max, step, value: initial, onInput: () => {}, onCommit: v => onChange(v) }
    : {
        min, max, step, value: initial,
        onInput: () => {},
        onCommit: v => onChange(v),
        valueAtT: t => snap(min + span * fnEvaluate(stepFnName, t)),
        tAtValue: v => {
          if (span <= 0) return 0
          const u = (snap(v) - min) / span
          return Math.max(0, Math.min(1, fnInverse(stepFnName, u)))
        }
      }

  const slider = new ScalarDragSlider(sliderOpts)
  slider.mount(container)
  requestAnimationFrame(() => slider.configure({ value: initial }))
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
  input.className = 'perform-animate-field__input perform-animate-field__input--number'
  const numDefault = typeof descriptor?.default === 'number' ? descriptor.default : undefined
  const numInitial = typeof value === 'number' ? value : numDefault
  input.value = numInitial !== undefined ? String(numInitial) : ''
  if (descriptor?.range) { input.min = String(descriptor.range[0]); input.max = String(descriptor.range[1]) }
  if (descriptor?.step !== undefined) input.step = String(descriptor.step)
  input.addEventListener('change', () => { const n = parseFloat(input.value); if (Number.isFinite(n)) onChange(n) })
  return input
}

/** @param {string} guid */
function resolveIntentName (guid) {
  if (!guid) return ''
  const intent = /** @type {Record<string, unknown> | undefined} */ (projectGraph.getIntents().get(guid))
  const name = intent?.name
  return typeof name === 'string' && name ? name : guid
}

/** @param {Record<string, unknown> | null} caps */
function getAnimationClasses (caps) {
  const list = caps?.animations
  if (!Array.isArray(list)) return []
  return list
    .map(entry => ({ cls: String(entry.class ?? ''), name: String(entry.name ?? entry.class ?? '') }))
    .filter(e => e.cls.length > 0)
}

/** @param {Record<string, unknown> | null} caps @param {string} cls */
function getClassDisplayMap (caps, cls) {
  const list = caps?.animations
  if (!Array.isArray(list) || !cls) return null
  const entry = /** @type {Record<string, unknown> | undefined} */ (list.find(e => e.class === cls))
  const display = entry?.display
  if (!display || typeof display !== 'object' || Array.isArray(display)) return null
  return /** @type {Record<string, unknown>} */ (display)
}

function dotKeyToLabel (dotKey) {
  const last = dotKey.split('.').pop() ?? dotKey
  return last.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())
}
