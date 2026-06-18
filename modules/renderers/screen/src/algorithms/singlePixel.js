import { AlgorithmBase } from './AlgorithmBase.js'
import { Color } from '../color.js'
import { FnCurve } from '../FnCurve.js'

const DEFAULT_STROBE = {
  lowFrequency: 0.5,
  highFrequency: 10,
  onTime: 0.02
}

/**
 * @param {unknown} fixtureProfile
 * @returns {{ lowFrequency: number; highFrequency: number; onTime: number }}
 */
function strobeConfigFromProfile (fixtureProfile) {
  const raw =
    fixtureProfile &&
    typeof fixtureProfile === 'object' &&
    fixtureProfile.params &&
    typeof fixtureProfile.params === 'object' &&
    !Array.isArray(fixtureProfile.params)
      ? fixtureProfile.params.strobe
      : undefined
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_STROBE }
  }
  const low =
    typeof raw.lowFrequency === 'number' && Number.isFinite(raw.lowFrequency)
      ? raw.lowFrequency
      : DEFAULT_STROBE.lowFrequency
  const high =
    typeof raw.highFrequency === 'number' && Number.isFinite(raw.highFrequency)
      ? raw.highFrequency
      : DEFAULT_STROBE.highFrequency
  const onTime =
    typeof raw.onTime === 'number' && Number.isFinite(raw.onTime)
      ? raw.onTime
      : DEFAULT_STROBE.onTime
  return { lowFrequency: low, highFrequency: high, onTime }
}

export class SinglePixelAlgorithm extends AlgorithmBase {
  constructor (fixtureProfile, instanceConfig, algorithmConfig) {
    super(fixtureProfile, instanceConfig, algorithmConfig)
    this._strobeConfig = strobeConfigFromProfile(fixtureProfile)
    this._strobe = 0
    this._nowSec = 0
    this._rgb = { r: 0, g: 0, b: 0 }
    this._intensityTrim =
      instanceConfig &&
      typeof instanceConfig.intensityTrim === 'number' &&
      Number.isFinite(instanceConfig.intensityTrim) &&
      instanceConfig.intensityTrim >= 0
        ? instanceConfig.intensityTrim
        : 1
    const fn = instanceConfig?.intensityFn
    this._intensityFn = typeof fn === 'string' && fn.length > 0 ? fn : 'linear'
  }

  update (nowSec) {
    this._nowSec = nowSec
  }

  _isStrobeOn (strobeValue) {
    if (!strobeValue || strobeValue === 0) return true
    const { lowFrequency, highFrequency, onTime } = this._strobeConfig
    const freq = lowFrequency + strobeValue * (highFrequency - lowFrequency)
    const period = 1 / freq
    return this._nowSec % period < onTime
  }

  apply (snapshot, _context) {
    const xbrightness = 1
    const withSpatial = true

    const color =
      snapshot.sample('light.color.xyY', withSpatial) || Color.black()
    const masterBrightness = snapshot.sample('master.brightness') ?? 1
    const masterBlackout = snapshot.sample('master.blackout') ?? false
    const spatialStrobe = snapshot.sample('light.strobe') ?? 0
    const aux = snapshot.sample('light.aux') ?? {}
    this._strobe = aux.strobe !== undefined ? aux.strobe : spatialStrobe

    const { r, g, b } = color.toRGB()
    const f =
      Math.max(0, Math.min(1, xbrightness * masterBrightness)) *
      (masterBlackout ? 0 : 1) *
      masterBrightness
    // Instance-level hardware gain (simulator-2d ignores these params).
    const finalF = FnCurve.evaluate(this._intensityFn, f * this._intensityTrim)
    this._rgb = { r: r * finalF, g: g * finalF, b: b * finalF }
  }

  draw (ctx, w, h, _nowSec) {
    if (!this._isStrobeOn(this._strobe)) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, w, h)
      return
    }
    const c = this._rgb
    ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(
      c.g * 255
    )},${Math.round(c.b * 255)})`
    ctx.fillRect(0, 0, w, h)
  }
}
