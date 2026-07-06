class EventLight extends EventBase {
    constructor(intent, drawConfig) {
        super(intent, drawConfig);
        const colorData = this._payload?.color;
        const alpha =
            typeof intent.alpha === 'number' && Number.isFinite(intent.alpha)
                ? Math.max(0, Math.min(1, intent.alpha))
                : 1;
        if (
            colorData &&
            typeof colorData.x === 'number' &&
            typeof colorData.y === 'number' &&
            typeof colorData.Y === 'number'
        ) {
            const effectiveY = Math.max(0, Math.min(1, colorData.Y * alpha));
            const layerColor = Color.fromXYY({
                x: colorData.x,
                y: colorData.y,
                Y: effectiveY
            });
            const { r, g, b } = layerColor.toRGB();
            const lin = layerColor.toLinearRGB();
            const luminance = 0.2126 * lin.r + 0.7152 * lin.g + 0.0722 * lin.b;
            this._fillColor = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
            this._insideLabelColor = luminance > 0.179 ? '#111' : '#fff';
        } else {
            this._fillColor = '#333';
            this._insideLabelColor = '#fff';
        }
        this._blendLabel = intent.blend || 'ADD';
    }

    draw(ctx, cx, cy, ppm) {
        const half = (this._drawConfig.square.size * ppm) / 2;
        ctx.fillStyle = this._fillColor;
        ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx - half, cy - half, half * 2, half * 2);
        ctx.clip();
        CanvasDraw.drawCenteredText(
            ctx,
            cx,
            cy,
            half * 2,
            this._blendLabel,
            this._insideLabelColor
        );
        ctx.restore();
        const label = this._name ? `${this._name} (L${this._layer})` : `L${this._layer}`;
        CanvasDraw.drawLabel(ctx, cx, cy, half, label);
    }
}

EventBase.registerClass('light', EventLight);
