class DmxMovingHeadMini extends LightBase {
  constructor (profile, instanceConfig, drawConfig) {
    super(profile, instanceConfig, drawConfig)
    this._drawConfig = drawConfig
    this._strobe = 0
    this.currentColor = null
    const py = profile.params?.strobe
    if (py && typeof py === 'object' && !Array.isArray(py)) {
      const c = this._strobeConfig
      const low =
        typeof py.lowFrequency === 'number' && Number.isFinite(py.lowFrequency)
          ? py.lowFrequency
          : c.lowFrequency
      const high =
        typeof py.highFrequency === 'number' &&
        Number.isFinite(py.highFrequency)
          ? py.highFrequency
          : c.highFrequency
      const onTime =
        typeof py.onTime === 'number' && Number.isFinite(py.onTime)
          ? py.onTime
          : c.onTime
      this._strobeConfig = {
        lowFrequency: low,
        highFrequency: high,
        onTime
      }
    }
  }

  applyIntentSnapshot (_context, snapshot) {
    const xbrightness = 1
    const withSpatial = true

    const color =
      snapshot.sample('light.color.xyY', withSpatial) || Color.black()
    const masterBrightness = snapshot.sample('master.brightness') ?? 1
    const boostBrightness = masterBrightness > 1 ? masterBrightness : 1
    const masterBlackout = snapshot.sample('master.blackout') ?? false
    const spatialStrobe = snapshot.sample('light.strobe') ?? 0
    const aux = snapshot.sample('light.aux') ?? {}
    this._strobe = aux['strobe'] !== undefined ? aux['strobe'] : spatialStrobe

    // RGBW extraction does not change the displayed color, so the simulator keeps the
    // resulting RGB and reflects master brightness the same way in both strobe states.
    const { r, g, b } = color.toRGB()
    const f =
      Math.max(0, Math.min(1, xbrightness * masterBrightness)) *
      (masterBlackout ? 0 : 1) *
      boostBrightness
    this.currentColor = { r: r * f, g: g * f, b: b * f }

    // Aim the head icon at the hub-resolved lookAt point (simple vector math). Rotation that points
    // the icon's top marker (local 0,-1) at the target: φ = atan2(dx, -dz). No target → no rotation.
    const target = snapshot.sample('target')
    if (Array.isArray(target)) {
      const dx = target[0] - this.location[0]
      const dz = target[2] - this.location[2]
      this._targetRotation = Math.atan2(dx, -dz)
    } else {
      this._targetRotation = null
    }
  }

  draw (ctx, cx, cy, ppm) {
    const radius = this._drawConfig.lamp.radius * ppm
    const c = this._isStrobeOn(this._strobe) ? this.currentColor : null
    const fillColor = c
      ? `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(
          c.b * 255
        )})`
      : '#000'
    CanvasDraw.fillCircle(ctx, cx, cy, radius, fillColor)
    const outline = globalThis.SimFixtureIcons?.movingHead
    if (outline && outline.complete && outline.naturalWidth > 0) {
      const d = radius * 2
      const rot = this._targetRotation
      if (typeof rot === 'number') {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(rot)
        ctx.drawImage(outline, -radius, -radius, d, d)
        ctx.restore()
      } else {
        ctx.drawImage(outline, cx - radius, cy - radius, d, d)
      }
    } else {
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.strokeStyle = '#444'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    CanvasDraw.drawLabel(ctx, cx, cy, radius, this.name)
  }
}
