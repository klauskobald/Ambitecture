/** Marker for an authored `target` (lookAt magnet) intent — shows its position and influence radius. */
class EventPositionTarget extends EventBase {
  constructor (intent, drawConfig) {
    super(intent, drawConfig)
    this._radius =
      typeof intent.radius === 'number' && Number.isFinite(intent.radius)
        ? intent.radius
        : 0
    this._isRepel = this._payload?.mode === 'Repel'
  }

  draw (ctx, cx, cy, ppm) {
    this._drawShadow(ctx, cx, cy, ppm)
    const accent = this._isRepel ? '#ff9d6e' : '#7cc6ff'
    if (this._radius > 0) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, this._radius * ppm, 0, Math.PI * 2)
      ctx.strokeStyle = this._isRepel ? 'rgba(255, 157, 110, 0.35)' : 'rgba(124, 198, 255, 0.35)'
      ctx.setLineDash([5, 5])
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.restore()
    }
    const r = (this._drawConfig?.square?.size ?? 0.3) * ppm * 0.55
    ctx.strokeStyle = accent
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
    this._drawForceArrows(ctx, cx, cy, r)
    const label = this._name ? `${this._name} (L${this._layer})` : `target L${this._layer}`
    CanvasDraw.drawLabel(ctx, cx, cy, r, label)
  }

  /** Four axis-aligned arrows — inward for attract, outward for repel. */
  _drawForceArrows (ctx, cx, cy, r) {
    const outer = r * 1.5
    const inner = r * 0.45
    const head = r * 0.5
    const spread = Math.PI / 6
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const tailDist = this._isRepel ? inner : outer
      const tipDist = this._isRepel ? outer : inner
      const tailX = cx + dx * tailDist
      const tailY = cy + dy * tailDist
      const tipX = cx + dx * tipDist
      const tipY = cy + dy * tipDist
      const ang = Math.atan2(tipY - tailY, tipX - tailX)
      ctx.beginPath()
      ctx.moveTo(tailX, tailY)
      ctx.lineTo(tipX, tipY)
      ctx.moveTo(tipX, tipY)
      ctx.lineTo(tipX - head * Math.cos(ang - spread), tipY - head * Math.sin(ang - spread))
      ctx.moveTo(tipX, tipY)
      ctx.lineTo(tipX - head * Math.cos(ang + spread), tipY - head * Math.sin(ang + spread))
      ctx.stroke()
    }
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
