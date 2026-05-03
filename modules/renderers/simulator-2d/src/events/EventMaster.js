class EventMaster extends EventBase {
  constructor (intent, drawConfig) {
    super(intent, drawConfig)
    // console.log('[EventMaster]', intent);
    const brightness = this._payload?.brightness
    this._brightness =
      typeof brightness === 'number' && Number.isFinite(brightness)
        ? brightness
        : 1
  }

  draw (ctx, cx, cy, ppm) {
    const radius = (this._drawConfig.square.size * ppm) / 2
    const intensity = Math.max(0, Math.min(1, this._brightness / 2))
    const channel = Math.round(80 + 175 * intensity)
    const fillColor = `rgb(${channel},${channel},${channel})`
    CanvasDraw.drawTriangle(ctx, cx, cy, radius, fillColor, '#aaa')
    const label = this._name ? `${this._name} (M)` : 'M'
    CanvasDraw.drawLabel(ctx, cx, cy, radius, label)
  }
}

EventBase.registerClass('master', EventMaster)
