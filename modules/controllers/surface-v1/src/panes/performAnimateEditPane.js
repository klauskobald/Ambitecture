import { projectGraph } from '../core/projectGraph.js'
import { getCapabilities } from '../core/systemCapabilities.js'
import { sendGraphCommand } from '../core/outboundQueue.js'
import { readAtDotPath } from '../core/dotPath.js'
import { getAnimatorViewer } from './animators/animatorViewerRegistry.js'
import { ScalarDragSlider } from '../edit/components/ScalarDragSlider.js'
import { evaluate as fnEvaluate, inverse as fnInverse } from '../edit/controls/fnCurve.js'

/**
 * Edit pane for a single animation record.
 * Outer framework owns: name, targetIntent label, class switcher.
 * Viewer plugin owns: field descriptors + optional custom widgets for content.* dotkeys.
 *
 * @param {{ onClose: () => void }} opts
 * @returns {{ el: HTMLElement, open: (record: Record<string, unknown>) => void }}
 */
export function createAnimationEditPane ({ onClose }) {
  const el = document.createElement('div')
  el.className = 'perform-animate-edit'
  el.hidden = true

  const header = document.createElement('div')
  header.className = 'perform-animate-edit__header'

  const backBtn = document.createElement('button')
  backBtn.type = 'button'
  backBtn.className = 'perform-animate-edit__back btn'
  backBtn.textContent = '←'
  backBtn.addEventListener('click', () => {
    el.hidden = true
    onClose()
  })

  const titleEl = document.createElement('span')
  titleEl.className = 'perform-animate-edit__title'

  header.appendChild(backBtn)
  header.appendChild(titleEl)

  const body = document.createElement('div')
  body.className = 'perform-animate-edit__body'

  el.appendChild(header)
  el.appendChild(body)

  /** @type {string} */
  let currentGuid = ''

  /**
   * @param {Record<string, unknown>} record
   */
  function open (record) {
    currentGuid = String(record.guid ?? '')
    const name = String(record.name ?? currentGuid)
    titleEl.textContent = name
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

    // name
    body.appendChild(makeFieldRow('Name', null,
      makeTextInput(String(record.name ?? ''), value => {
        titleEl.textContent = value
        sendAnimationPatch(guid, { name: value })
      })
    ))

    // targetIntent (read-only — intent guid resolves to name)
    const intentGuid = String(record.targetIntent ?? record.intent ?? '')
    body.appendChild(makeFieldRow('Target intent', null,
      makeReadOnly(resolveIntentName(intentGuid))
    ))

    // class switcher (only shown when hub advertises ≥ 2 classes)
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
    if (display && Object.keys(display).length > 0) {
      const section = document.createElement('div')
      section.className = 'perform-animate-edit__section'

      const sectionHeading = document.createElement('p')
      sectionHeading.className = 'perform-animate-edit__section-title'
      sectionHeading.textContent = 'Content'
      section.appendChild(sectionHeading)

      for (const [dotKey, displayConfig] of Object.entries(display)) {
        const value = readAtDotPath(/** @type {Record<string, unknown>} */ (record), dotKey)
        const descriptor = viewer?.getFieldDescriptor(dotKey) ?? null
        const label = descriptor?.name ?? dotKeyToLabel(dotKey)
        const hint = descriptor?.hint ?? null

        const customEl = viewer?.renderField(dotKey, value, newValue => {
          sendAnimationPatch(guid, { [dotKey]: newValue })
        }) ?? null

        if (customEl) {
          section.appendChild(makeFieldRow(label, hint, customEl))
          continue
        }

        const widgetType = displayConfig && typeof displayConfig === 'object'
          ? String(/** @type {Record<string, unknown>} */ (displayConfig).type ?? '')
          : ''
        section.appendChild(makeFieldRow(label, hint,
          makeGenericWidget(widgetType, value, descriptor, newValue => {
            sendAnimationPatch(guid, { [dotKey]: newValue })
          })
        ))
      }

      body.appendChild(section)
    }
  }

  return { el, open }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * @param {string} guid
 * @param {Record<string, unknown>} patch
 */
function sendAnimationPatch (guid, patch) {
  sendGraphCommand({
    op: 'upsert',
    entityType: 'animation',
    guid,
    patch,
    persistence: 'runtimeAndDurable'
  })
}

/**
 * @param {string} label
 * @param {string | null} hint
 * @param {HTMLElement} widget
 * @returns {HTMLDivElement}
 */
function makeFieldRow (label, hint, widget) {
  const row = document.createElement('div')
  row.className = 'perform-animate-field'

  const labelEl = document.createElement('div')
  labelEl.className = 'perform-animate-field__label'
  labelEl.textContent = label

  if (hint) {
    const hintEl = document.createElement('span')
    hintEl.className = 'perform-animate-field__hint'
    hintEl.textContent = hint
    labelEl.appendChild(hintEl)
  }

  row.appendChild(labelEl)
  row.appendChild(widget)
  return row
}

/**
 * @param {unknown} initialValue
 * @param {(value: string) => void} onCommit
 * @returns {HTMLInputElement}
 */
function makeTextInput (initialValue, onCommit) {
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'perform-animate-field__input'
  input.value = typeof initialValue === 'string' ? initialValue : ''
  input.addEventListener('change', () => onCommit(input.value))
  return input
}

/**
 * @param {string} text
 * @returns {HTMLSpanElement}
 */
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
 * @returns {HTMLSelectElement}
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
 * @param {string} type widget type from systemCapabilities display config
 * @param {unknown} value current value from animation record
 * @param {{ name?: string, range?: [number, number], step?: number, options?: string[], optionsRef?: string } | null} descriptor
 * @param {(value: unknown) => void} onChange
 * @returns {HTMLElement}
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
 * @param {{ range?: [number, number], step?: number } | null} descriptor
 * @param {(value: number) => void} onChange
 * @returns {HTMLElement}
 */
function makeSliderWidget (value, descriptor, onChange) {
  const min = descriptor?.range?.[0] ?? 0
  const max = descriptor?.range?.[1] ?? 100
  const span = max - min
  const step = descriptor?.step
  const fallback = typeof descriptor?.default === 'number' ? descriptor.default : min
  const initial = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  const stepFnName = typeof descriptor?.stepFunction === 'string' && descriptor.stepFunction.length > 0
    ? descriptor.stepFunction
    : null

  const container = document.createElement('div')
  container.className = 'perform-animate-field__slider'

  /** @param {number} v @returns {number} */
  const snap = (v) => {
    if (!step) return Math.max(min, Math.min(max, v))
    return Math.max(min, Math.min(max, Math.round((v - min) / step) * step + min))
  }

  const sliderOpts = stepFnName == null
    ? { min, max, step, value: initial, onInput: () => {}, onCommit: v => onChange(v) }
    : {
        min, max, step, value: initial,
        onInput: () => {},
        onCommit: v => onChange(v),
        valueAtT: (t) => snap(min + span * fnEvaluate(stepFnName, t)),
        tAtValue: (v) => {
          if (span <= 0) return 0
          const u = (snap(v) - min) / span
          return Math.max(0, Math.min(1, fnInverse(stepFnName, u)))
        }
      }

  const slider = new ScalarDragSlider(sliderOpts)
  slider.mount(container)
  return container
}

/**
 * @param {unknown} value
 * @param {{ range?: [number, number], step?: number } | null} descriptor
 * @param {(value: number) => void} onChange
 * @returns {HTMLInputElement}
 */
function makeNumberInput (value, descriptor, onChange) {
  const input = document.createElement('input')
  input.type = 'number'
  input.className = 'perform-animate-field__input perform-animate-field__input--number'
  const numDefault = typeof descriptor?.default === 'number' ? descriptor.default : undefined
  const numInitial = typeof value === 'number' ? value : numDefault
  input.value = numInitial !== undefined ? String(numInitial) : ''
  if (descriptor?.range) {
    input.min = String(descriptor.range[0])
    input.max = String(descriptor.range[1])
  }
  if (descriptor?.step !== undefined) {
    input.step = String(descriptor.step)
  }
  input.addEventListener('change', () => {
    const n = parseFloat(input.value)
    if (Number.isFinite(n)) onChange(n)
  })
  return input
}

/** @param {string} guid @returns {string} */
function resolveIntentName (guid) {
  if (!guid) return '—'
  const intent = /** @type {Record<string, unknown> | undefined} */ (
    projectGraph.getIntents().get(guid)
  )
  const name = intent?.name
  return typeof name === 'string' && name ? name : guid
}

/**
 * @param {Record<string, unknown> | null} caps
 * @returns {Array<{ cls: string, name: string }>}
 */
function getAnimationClasses (caps) {
  const list = caps?.animations
  if (!Array.isArray(list)) return []
  return list
    .map(entry => ({
      cls: String(entry.class ?? ''),
      name: String(entry.name ?? entry.class ?? '')
    }))
    .filter(e => e.cls.length > 0)
}

/**
 * @param {Record<string, unknown> | null} caps
 * @param {string} cls
 * @returns {Record<string, unknown> | null}
 */
function getClassDisplayMap (caps, cls) {
  const list = caps?.animations
  if (!Array.isArray(list) || !cls) return null
  const entry = /** @type {Record<string, unknown> | undefined} */ (
    list.find(e => e.class === cls)
  )
  const display = entry?.display
  if (!display || typeof display !== 'object' || Array.isArray(display)) return null
  return /** @type {Record<string, unknown>} */ (display)
}

/** Converts a dotKey tail segment to a display label. */
function dotKeyToLabel (dotKey) {
  const last = dotKey.split('.').pop() ?? dotKey
  return last.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())
}
