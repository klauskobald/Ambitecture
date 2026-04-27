class DmxLightStatic extends LightBase {
  constructor(profile, instanceConfig, drawConfig) {
    super(profile, instanceConfig, drawConfig)
    this._drawConfig = drawConfig
    this._rawColor = null
    this._strobe = 0
    this._masterBrightness = 1
    this._masterBlackout = false
    this._spatialFactor = 1
    this.currentColor = null
  }

  handleEvent(event, spatial) {
    switch (event.class) {
      case 'light':
        this._handleLight(event, spatial)
        break
      case 'master':
        this._handleMaster(event)
        break
    }
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

  _handleLight(event, spatial) {
    const colorData = event.params?.color
    if (!colorData) return
    this._rawColor = Color.fromXYY(colorData).toRGB()
    if (event.params?.strobe !== undefined) this._strobe = event.params.strobe
    this._spatialFactor = this._computeSpatialFactor(spatial)
    this._applyMaster()
  }

  _handleMaster(event) {
    if (event.params?.brightness !== undefined)
      this._masterBrightness = event.params.brightness
    if (event.params?.blackout !== undefined)
      this._masterBlackout = event.params.blackout
    this._applyMaster()
  }

  _computeSpatialFactor(spatial) {
    if (!spatial || this.range <= 0) return 1
    const distance = spatial.magnitude()
    return Math.max(0, 1 - distance / this.range)
  }

  _applyMaster() {
    if (!this._rawColor) return
    const { r, g, b } = this._rawColor
    const f = this._masterBrightness * this._spatialFactor * (this._masterBlackout ? 0 : 1)
    this.currentColor = { r: r * f, g: g * f, b: b * f }
  }
}
