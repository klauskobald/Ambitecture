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
    this._drawShadow(ctx, cx, cy, ppm)
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

  /** Cast shadow on the floor — drifts to bottom-right and blurs as the target rises (position[1]). */
  _drawShadow (ctx, cx, cy, ppm) {
    const cfg = this._drawConfig?.shadow
    if (!cfg) return
    const height = Math.max(0, this._position?.[1] ?? 0) + 0.1
    const offset = height * cfg.offsetPerMeterPx
    const blur = height * cfg.blurPerMeterPx
    const opacity = cfg.baseOpacity / (1 + height * 0.5)
    const radius = (this._drawConfig?.square?.size ?? 0.3) * ppm * cfg.baseRadiusFactor
    const sx = cx + offset
    const sy = cy + offset
    const extent = radius + Math.max(0, blur)
    if (!(extent > 0)) return
    ctx.save()
    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, extent)
    const coreStop = radius / extent
    grad.addColorStop(0, `rgba(${cfg.color}, ${opacity})`)
    if (coreStop < 1) {
      grad.addColorStop(coreStop, `rgba(${cfg.color}, ${opacity * 0.4})`)
    }
    grad.addColorStop(1, `rgba(${cfg.color}, 0)`)
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(sx, sy, extent, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

EventBase.registerClass('target', EventPositionTarget)
