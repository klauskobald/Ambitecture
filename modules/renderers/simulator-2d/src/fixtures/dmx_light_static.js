class DmxLightStatic extends LightBase {
  constructor(profile, instanceConfig, drawConfig) {
    super(profile, instanceConfig, drawConfig)
    this._drawConfig = drawConfig
    this._strobe = 0
    this.currentColor = null
  }

  applyIntentSnapshot(_context, snapshot) {
    const color = snapshot.sample('light.color.xyY') || Color.black()
    const masterBrightness = snapshot.sample('master.brightness') ?? 1
    const masterBlackout = snapshot.sample('master.blackout') ?? false
    this._strobe = snapshot.sample('light.strobe') ?? 0

    const { r, g, b } = color.toRGB()
    const f = masterBrightness * (masterBlackout ? 0 : 1)
    this.currentColor = { r: r * f, g: g * f, b: b * f }
  }

  draw(ctx, cx, cy, ppm) {
    const radius = this._drawConfig.lamp.radius * ppm
    const c = this._isStrobeOn(this._strobe) ? this.currentColor : null
    const fillColor = c
      ? `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`
      : '#2a2a2a'
    CanvasDraw.drawCircle(ctx, cx, cy, radius, fillColor, '#444')
    CanvasDraw.drawLabel(ctx, cx, cy, radius, this.name)
  }

}
