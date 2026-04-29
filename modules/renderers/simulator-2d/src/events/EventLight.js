class EventLight extends EventBase {
    constructor(intent, drawConfig) {
        super(intent, drawConfig);
        const colorData = this._payload?.color;
        if (colorData) {
            const { r, g, b } = Color.fromXYY(colorData).toRGB();
            this._fillColor = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
        } else {
            this._fillColor = '#333';
        }
    }

    draw(ctx, cx, cy, ppm) {
        const half = (this._drawConfig.square.size * ppm) / 2;
        ctx.fillStyle = this._fillColor;
        ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
        const label = this._name ? `${this._name} (L${this._layer})` : `L${this._layer}`;
        CanvasDraw.drawLabel(ctx, cx, cy, half, label);
    }
}
