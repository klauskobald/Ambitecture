import { PropertyControl } from './PropertyControl.js'
import { projectGraph } from '../../core/projectGraph.js'
import { applyDelta } from './controlHelpers.js'
import { evaluate as fnEvaluate, inverse as fnInverse } from './fnCurve.js'
import { ScalarDragSlider } from '../components/ScalarDragSlider.js'

export class SliderControl extends PropertyControl {
  constructor (descriptor, onCommit, selectionSize) {
    super(descriptor, onCommit, selectionSize)
    /** @type {ScalarDragSlider | null} */
    this._scalar = null
    /** @type {boolean} */
    this._isDelta = false
    /** whether the last _applyState was multi-select delta mode (avoid resetting thumb on every graph refresh) */
    this._wasDeltaMode = false
    /** @type {Map<string, number> | null} frozen property values at drag start for delta multi-select */
    this._deltaBaseline = null
  }

  destroy () {
    this._scalar?.destroy()
    this._scalar = null
  }

  /** @param {HTMLElement} area */
  _buildControlWidget (area) {
    const bubbleRaw = this._descriptor.bubbleCharWidth
    const bubbleCharWidth = Number(bubbleRaw) > 0 ? Number(bubbleRaw) : undefined

    this._scalar = new ScalarDragSlider({
      min: 0,
      max: 1,
      step: 0.01,
      value: 0,
      relativeTrack: false,
      bubbleCharWidth,
      onInput: (v) => this._onScalarInput(v),
      onCommit: () => this._saveProject(),
      onDragStart: () => this._captureDeltaBaseline(),
      onDragEnd: () => { this._deltaBaseline = null }
    })
    this._scalar.mount(area)
  }

  /**
   * @param {{ mode: 'same'|'mixed'|'absent', value: unknown, enableState: string, selectionSize: number }} state
   */
  _applyState (state) {
    if (!this._scalar) return

    this._isDelta = state.mode === 'mixed' && state.selectionSize > 1

    const range = /** @type {number[] | undefined} */ (this._descriptor.range)
    const min = range?.[0] ?? 0
    const max = range?.[1] ?? 1
    const span = max - min

    if (this._isDelta) {
      const deltaConfig = this._getDeltaConfig()
      const dMin = deltaConfig.range[0]
      const dMax = deltaConfig.range[1]
      const deltaStep = this._resolveStep(deltaConfig.step, dMin, dMax)
      const noOp = deltaConfig.fn === 'MULTIPLY' ? 1 : 0
      const enteringDelta = !this._wasDeltaMode
      const patch = {
        min: dMin,
        max: dMax,
        step: deltaStep,
        mapping: 'linear',
        relativeTrack: true,
        defaultDomainValue: noOp
      }
      if (enteringDelta) {
        patch.value = noOp
      }
      this._scalar.configure(patch)
    } else {
      const absStep = this._resolveStep(this._descriptor.step, min, max)
      const rawFn = this._descriptor.stepFunction
      const stepFnName = typeof rawFn === 'string' && rawFn.length > 0 ? rawFn : null

      let initialV = min
      if (state.mode === 'same' && state.value !== undefined && span !== 0) {
        initialV = Number(state.value)
      }

      const defAbs = Number(this._descriptor.defaultValue)
      const defaultDomainValue = Number.isFinite(defAbs) ? defAbs : undefined
      if (stepFnName == null) {
        this._scalar.configure({
          min,
          max,
          step: absStep,
          value: initialV,
          mapping: 'linear',
          relativeTrack: false,
          defaultDomainValue
        })
      } else {
        this._scalar.configure({
          min,
          max,
          step: absStep,
          value: initialV,
          relativeTrack: false,
          defaultDomainValue,
          valueAtT: (t) => {
            const u = fnEvaluate(stepFnName, t)
            const raw = min + span * u
            return this._snap(raw, min, max, absStep)
          },
          tAtValue: (v) => {
            if (span <= 0) return 0
            const snapped = this._snap(v, min, max, absStep)
            const u = (snapped - min) / span
            return Math.max(0, Math.min(1, fnInverse(stepFnName, u)))
          }
        })
      }
    }

    this._wasDeltaMode = this._isDelta
  }

  /**
   * @param {number} v
   */
  _onScalarInput (v) {
    if (this._isDelta) {
      this._applyDeltaValue(v)
    } else {
      this._applyAbsoluteValue(v)
    }
  }

  /**
   * @param {number} v
   */
  _applyAbsoluteValue (v) {
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    for (const guid of this._currentGuids) {
      this._updateProperty(guid, dotKey, v)
    }
  }

  /**
   * @param {number} deltaVal
   */
  _applyDeltaValue (deltaVal) {
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    const range = /** @type {number[] | undefined} */ (this._descriptor.range)
    const pMin = range?.[0] ?? 0
    const pMax = range?.[1] ?? 1
    const { fn } = this._getDeltaConfig()
    const baseline = this._deltaBaseline
    for (const guid of this._currentGuids) {
      const fromGraph = /** @type {number} */ (projectGraph.getEffectiveIntentProperty(guid, dotKey) ?? pMin)
      const original = baseline !== null ? (baseline.get(guid) ?? fromGraph) : fromGraph
      const newVal = applyDelta(original, deltaVal, fn, pMin, pMax)
      this._updateProperty(guid, dotKey, newVal)
    }
  }

  _captureDeltaBaseline () {
    if (!this._isDelta) return
    const dotKey = /** @type {string} */ (this._descriptor.dotKey)
    const range = /** @type {number[] | undefined} */ (this._descriptor.range)
    const pMin = range?.[0] ?? 0
    const map = new Map()
    for (const guid of this._currentGuids) {
      map.set(guid, Number(projectGraph.getEffectiveIntentProperty(guid, dotKey) ?? pMin))
    }
    this._deltaBaseline = map
  }

  /**
   * @param {unknown} explicit
   * @param {number} rangeMin
   * @param {number} rangeMax
   * @returns {number}
   */
  _resolveStep (explicit, rangeMin, rangeMax) {
    if (explicit !== undefined && explicit !== null && Number.isFinite(Number(explicit))) {
      const s = Number(explicit)
      return s > 0 ? s : (rangeMax - rangeMin) / 255
    }
    const span = rangeMax - rangeMin
    return span / 255
  }

  /**
   * @param {number} value
   * @param {number} min
   * @param {number} max
   * @param {number} step
   * @returns {number}
   */
  _snap (value, min, max, step) {
    if (!Number.isFinite(value)) return min
    const s = step > 0 ? step : (max - min) / 255
    const snapped = min + Math.round((value - min) / s) * s
    return Math.max(min, Math.min(max, snapped))
  }

  /** @returns {{ fn: string, range: [number, number], step?: number }} */
  _getDeltaConfig () {
    const delta = /** @type {Record<string, unknown> | undefined} */ (this._descriptor.delta)
    const channel = /** @type {Record<string, unknown> | undefined} */ (delta?.['value'])
    if (channel) {
      const stepRaw = channel.step
      const step = stepRaw !== undefined && Number.isFinite(Number(stepRaw)) ? Number(stepRaw) : undefined
      return {
        fn: String(channel.fn ?? 'ADD'),
        range: /** @type {[number, number]} */ (Array.isArray(channel.range) ? channel.range : [-1, 1]),
        step
      }
    }
    return { fn: 'ADD', range: [-1, 1] }
  }
}
