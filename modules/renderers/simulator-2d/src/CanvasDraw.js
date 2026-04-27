const CanvasDraw = {
    drawCircle(ctx, cx, cy, radius, fillColor, strokeColor) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
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
};
