class RopeConnector extends ConnectorBase {
    constructor(record, drawConfig) {
        super(record, drawConfig);
        this._chain = new RopeChain();
    }

    draw(ctx, ax, ay, bx, by) {
        const c = this._drawConfig.rope ?? {};
        const points = this._chain.points(ax, ay, bx, by, c.sagPx ?? 16, c.ease ?? 0.2);
        CanvasDraw.drawPolyline(ctx, points, c.color ?? '#d1a87a', c.width ?? 2);
    }
}

ConnectorBase.registerKind('rope', RopeConnector);
