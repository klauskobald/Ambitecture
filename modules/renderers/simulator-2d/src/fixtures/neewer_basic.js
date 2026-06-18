class NeewerBasic extends LightBase {
  constructor (profile, instanceConfig, drawConfig) {
    super(profile, instanceConfig, drawConfig)
    this._drawConfig = drawConfig
    this._trimBrightness = fixtureTrimBrightness(instanceConfig.trim)
    this.currentColor = null
  }

  applyIntentSnapshot (_context, snapshot) {
    const color =
      snapshot.sample('light.color.xyY', true) || Color.black()
    const masterBrightness = snapshot.sample('master.brightness') ?? 1
    const masterBlackout = snapshot.sample('master.blackout') ?? false

    const { r, g, b } = color.toRGB()
    const f =
      Math.max(0, masterBrightness) *
      (masterBlackout ? 0 : 1) *
      this._trimBrightness
    this.currentColor = { r: r * f, g: g * f, b: b * f }
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
