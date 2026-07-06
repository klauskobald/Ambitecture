const CanvasDraw = {
    fillCircle(ctx, cx, cy, radius, fillColor) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = fillColor;
        ctx.fill();
    },

    drawCircle(ctx, cx, cy, radius, fillColor, strokeColor) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1;
        ctx.stroke();
    },

    drawTriangle(ctx, cx, cy, radius, fillColor, strokeColor) {
        ctx.beginPath();
        ctx.moveTo(cx, cy - radius);
        ctx.lineTo(cx + radius, cy + radius);
        ctx.lineTo(cx - radius, cy + radius);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1;
        ctx.stroke();
    },

    drawLabel(ctx, cx, cy, radius, text) {
        ctx.fillStyle = '#666';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(text, cx, cy + radius + 12);
    },

    drawCenteredText(ctx, cx, cy, maxWidth, text, fillStyle) {
        let fontSize = 10;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${fontSize}px monospace`;
        while (fontSize > 4 && ctx.measureText(text).width > maxWidth * 0.9) {
            fontSize -= 1;
            ctx.font = `${fontSize}px monospace`;
        }
        ctx.fillStyle = fillStyle;
        ctx.fillText(text, cx, cy);
    },

    drawLine(ctx, ax, ay, bx, by, color, width) {
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
    },

    /** Zigzag spring between (ax,ay) and (bx,by): peaks alternate perpendicular to the axis. */
    drawZigzag(ctx, ax, ay, bx, by, amplitude, period, color, width) {
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (len < 1) {
            CanvasDraw.drawLine(ctx, ax, ay, bx, by, color, width);
            return;
        }
        const ux = dx / len;
        const uy = dy / len;
        const px = -uy;
        const py = ux;
        const segments = Math.max(2, Math.round(len / period));
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        for (let i = 1; i < segments; i++) {
            const t = i / segments;
            const sign = i % 2 === 0 ? 1 : -1;
            const cx = ax + dx * t + px * amplitude * sign;
            const cy = ay + dy * t + py * amplitude * sign;
            ctx.lineTo(cx, cy);
        }
        ctx.lineTo(bx, by);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
    },

    /** @param {Array<[number, number]>} points */
    drawPolyline(ctx, points, color, width) {
        if (!points || points.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(points[0][0], points[0][1]);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i][0], points[i][1]);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
    },
};
