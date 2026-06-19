class SpringConnector extends ConnectorBase {
    draw(ctx, ax, ay, bx, by) {
        const c = this._drawConfig.spring ?? {};
        CanvasDraw.drawZigzag(
            ctx, ax, ay, bx, by,
            c.amplitudePx ?? 7,
            c.periodPx ?? 14,
            c.color ?? '#9bd17a',
            c.width ?? 2
        );
    }
}

ConnectorBase.registerKind('spring', SpringConnector);
