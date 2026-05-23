class DmxBasicStatic extends LightBase {
  constructor (profile, instanceConfig, drawConfig) {
    super(profile, instanceConfig, drawConfig)
    this._drawConfig = drawConfig
    this.currentColor = null
  }

  applyIntentSnapshot (_context, snapshot) {
    // light.brightness additive sample is 0 with no intents — fold dimming via master + RGB.
    const xbrightness = 1
    const withSpatial = true

    const color =
      snapshot.sample('light.color.xyY', withSpatial) || Color.black()
    const masterBrightness = snapshot.sample('master.brightness') ?? 1
    const boostBrightness = masterBrightness > 1 ? masterBrightness : 1
    const masterBlackout = snapshot.sample('master.blackout') ?? false

    const { r, g, b } = color.toRGB()
    const brightnessFactor =
      Math.max(0, Math.min(1, xbrightness * masterBrightness)) *
      (masterBlackout ? 0 : 1) *
      boostBrightness
    this.currentColor = {
      r: r * brightnessFactor,
      g: g * brightnessFactor,
      b: b * brightnessFactor
    }
  }

  draw (ctx, cx, cy, ppm) {
    const radius = this._drawConfig.lamp.radius * ppm
    const c = this.currentColor
    const fillColor = c
      ? `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(
          c.b * 255
        )})`
      : '#000'
    CanvasDraw.fillCircle(ctx, cx, cy, radius, fillColor)
    const outline = globalThis.SimFixtureIcons?.rgbSimple
    if (outline && outline.complete && outline.naturalWidth > 0) {
      const d = radius * 2
      ctx.drawImage(outline, cx - radius, cy - radius, d, d)
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
