class RodConnector extends ConnectorBase {
    draw(ctx, ax, ay, bx, by) {
        const c = this._drawConfig.rod ?? {};
        CanvasDraw.drawLine(ctx, ax, ay, bx, by, c.color ?? '#8aa0ff', c.width ?? 2);
    }
}

ConnectorBase.registerKind('rod', RodConnector);
