class Screen extends LightBase {
  constructor (profile, instanceConfig, drawConfig) {
    super(profile, instanceConfig, drawConfig)
    this._drawConfig = drawConfig
    this._strobe = 0
    this._rgb = { r: 0, g: 0, b: 0 }
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

  static _innerFromScreenSvg (cx, cy, w, h) {
    const vb = 64
    const rw = 48
    const rh = 40
    const rectRx = 8
    const innerW = (rw / vb) * w
    const innerH = (rh / vb) * h
    const innerX = cx - innerW / 2
    const innerY = cy - innerH / 2
    const innerCorner = innerW * (rectRx / rw)
    return { innerX, innerY, innerW, innerH, innerCorner }
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
    this._strobe =
      aux.strobe !== undefined ? aux.strobe : spatialStrobe

    const { r, g, b } = color.toRGB()
    const f =
      Math.max(0, Math.min(1, xbrightness * masterBrightness)) *
      (masterBlackout ? 0 : 1) *
      boostBrightness
    this._rgb = { r: r * f, g: g * f, b: b * f }
  }

  draw (ctx, cx, cy, ppm) {
    const lampR = this._drawConfig.lamp?.radius
    const radiusM =
      typeof lampR === 'number' && Number.isFinite(lampR) && lampR > 0
        ? lampR
        : 0.2
    const halfW = radiusM * ppm
    const halfH = radiusM * ppm
    const x = cx - halfW
    const y = cy - halfH
    const w = halfW * 2
    const h = halfH * 2
    const { innerX, innerY, innerW, innerH, innerCorner } =
      Screen._innerFromScreenSvg(cx, cy, w, h)
    const c = this._isStrobeOn(this._strobe) ? this._rgb : null
    const fillColor = c
      ? `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(
          c.b * 255
        )})`
      : '#000'

    ctx.fillStyle = fillColor
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath()
      ctx.roundRect(innerX, innerY, innerW, innerH, innerCorner)
      ctx.fill()
    } else {
      ctx.fillRect(innerX, innerY, innerW, innerH)
    }

    const frame = globalThis.SimFixtureIcons?.screen
    if (frame && frame.complete && frame.naturalWidth > 0) {
      ctx.drawImage(frame, x, y, w, h)
    } else {
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(innerX, innerY, innerW, innerH, innerCorner)
      } else {
        ctx.rect(innerX, innerY, innerW, innerH)
      }
      ctx.stroke()
    }

    CanvasDraw.drawLabel(ctx, cx, cy, Math.max(halfW, halfH), this.name)
  }
}
