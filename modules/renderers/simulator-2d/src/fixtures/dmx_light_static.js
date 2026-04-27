class DmxLightStatic extends LightBase {
  constructor (profile, instanceConfig, drawConfig) {
    super(profile, instanceConfig, drawConfig)
    this._drawConfig = drawConfig
    this._rawColor = null
    this._strobe = 0
    this._masterBrightness = 1
    this._masterBlackout = false
    this.currentColor = null
  }

  handleEvent (event) {
    switch (event.class) {
      case 'light':
        this._handleLight(event)
        break
      case 'master':
        this._handleMaster(event)
        break
    }
  }

  draw (ctx, cx, cy, ppm) {
    const radius = this._drawConfig.lamp.radius * ppm
    const c = this._isStrobeOn(this._strobe) ? this.currentColor : null
    const fillColor = c
      ? `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(
          c.b * 255
        )})`
      : '#2a2a2a'
    CanvasDraw.drawCircle(ctx, cx, cy, radius, fillColor, '#444')
    CanvasDraw.drawLabel(ctx, cx, cy, radius, this.name)
  }

  _handleLight (event) {
    const colorData = event.params?.color
    if (!colorData) return
    this._rawColor = Color.fromXYY(colorData).toRGB()
    if (event.params?.strobe !== undefined) this._strobe = event.params.strobe
    this._applyMaster()
  }

  _handleMaster (event) {
    if (event.params?.brightness !== undefined)
      this._masterBrightness = event.params.brightness
    if (event.params?.blackout !== undefined)
      this._masterBlackout = event.params.blackout
    this._applyMaster()
  }

  _applyMaster () {
    if (!this._rawColor) return
    const { r, g, b } = this._rawColor
    this.currentColor = this._masterBlackout
      ? { r: 0, g: 0, b: 0 }
      : {
          r: r * this._masterBrightness,
          g: g * this._masterBrightness,
          b: b * this._masterBrightness
        }
  }
}
