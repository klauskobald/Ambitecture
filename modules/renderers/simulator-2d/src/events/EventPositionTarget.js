/** Marker for an authored `target` (lookAt magnet) intent — shows its position and influence radius. */
class EventPositionTarget extends EventBase {
  constructor (intent, drawConfig) {
    super(intent, drawConfig)
    this._radius =
      typeof intent.radius === 'number' && Number.isFinite(intent.radius)
        ? intent.radius
        : 0
  }

  draw (ctx, cx, cy, ppm) {
    if (this._radius > 0) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, this._radius * ppm, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(124, 198, 255, 0.35)'
      ctx.setLineDash([5, 5])
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.restore()
    }
    const r = (this._drawConfig?.square?.size ?? 0.3) * ppm * 0.55
    ctx.strokeStyle = '#7cc6ff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx - r * 1.7, cy)
    ctx.lineTo(cx + r * 1.7, cy)
    ctx.moveTo(cx, cy - r * 1.7)
    ctx.lineTo(cx, cy + r * 1.7)
    ctx.stroke()
    const label = this._name ? `${this._name} (L${this._layer})` : `target L${this._layer}`
    CanvasDraw.drawLabel(ctx, cx, cy, r, label)
  }
}

EventBase.registerClass('target', EventPositionTarget)
