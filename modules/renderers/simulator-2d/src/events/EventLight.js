class EventLight extends EventBase {
    constructor(intent, drawConfig) {
        super(intent, drawConfig);
        const colorData = this._payload?.color;
        const alpha =
            typeof intent.alpha === 'number' && Number.isFinite(intent.alpha)
                ? Math.max(0, Math.min(1, intent.alpha))
                : 1;
        const blend =
            intent.blend === 'ALPHA' || intent.blend === 'MULTIPLY'
                ? intent.blend
                : 'ADD';
        if (
            colorData &&
            typeof colorData.x === 'number' &&
            typeof colorData.y === 'number' &&
            typeof colorData.Y === 'number'
        ) {
            const layerColor = new Color(
                colorData.x,
                colorData.y,
                Math.max(0, Math.min(1, colorData.Y))
            );
            const mixed = Color.black().blend(layerColor, blend, alpha);
            const { r, g, b } = mixed.toRGB();
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

EventBase.registerClass('light', EventLight);
