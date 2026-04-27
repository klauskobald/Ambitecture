class CanvasRenderer {
    constructor(canvasEl, config) {
        this.canvas = canvasEl;
        this.ctx = canvasEl.getContext('2d');
        this.fixtures = [];
        this.padding = 40;

        const bb = config.BOUNDING_BOX.split(' ').map(Number);
        this.x1 = bb[0]; this.y1 = bb[1]; this.z1 = bb[2];
        this.x2 = bb[3]; this.y2 = bb[4]; this.z2 = bb[5];
        this.ppm = config.PIXEL_PER_METER;
        this.strobeConfig = config.STROBE ?? { lowFrequency: 0.5, highFrequency: 10, onTime: 0.02 };

        this.canvas.width  = (this.x2 - this.x1) * this.ppm + 2 * this.padding;
        this.canvas.height = (this.z2 - this.z1) * this.ppm + 2 * this.padding;
    }

    setFixtures(fixtures) {
        this.fixtures = fixtures;
    }

    start() {
        const loop = () => {
            this.draw();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    draw() {
        const { ctx, canvas, ppm, padding, x1, z1, x2, z2 } = this;
        const nowSec = performance.now() / 1000;

        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        this._drawGrid();

        const radius = 0.1 * ppm;

        for (const fixture of this.fixtures) {
            const { cx, cy } = this.worldToCanvas(fixture.location[0], fixture.location[2]);
            const c = fixture.currentColor;
            const strobeOn = this._isStrobeOn(fixture, nowSec);

            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);

            if (c && strobeOn) {
                ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
            } else {
                ctx.fillStyle = '#2a2a2a';
            }
            ctx.fill();

            ctx.strokeStyle = '#444';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = '#666';
            ctx.font = '10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(fixture.name, cx, cy + radius + 12);
        }
    }

    _isStrobeOn(fixture, nowSec) {
        const strobe = fixture._strobe;
        if (!strobe || strobe === 0) return true;
        const { lowFrequency, highFrequency, onTime } = this.strobeConfig;
        const freq = lowFrequency + strobe * (highFrequency - lowFrequency);
        const period = 1 / freq;
        return (nowSec % period) < onTime;
    }

    worldToCanvas(wx, wz) {
        return {
            cx: (wx - this.x1) * this.ppm + this.padding,
            cy: (wz - this.z1) * this.ppm + this.padding,
        };
    }

    _drawGrid() {
        const { ctx, canvas, ppm, padding, x1, z1, x2, z2 } = this;
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1;

        for (let x = Math.ceil(x1); x <= x2; x++) {
            const cx = (x - x1) * ppm + padding;
            ctx.beginPath();
            ctx.moveTo(cx, 0);
            ctx.lineTo(cx, canvas.height);
            ctx.stroke();
        }

        for (let z = Math.ceil(z1); z <= z2; z++) {
            const cy = (z - z1) * ppm + padding;
            ctx.beginPath();
            ctx.moveTo(0, cy);
            ctx.lineTo(canvas.width, cy);
            ctx.stroke();
        }
    }
}
