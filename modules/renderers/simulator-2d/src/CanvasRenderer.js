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

        this.canvas.width  = (this.x2 - this.x1) * this.ppm + 2 * this.padding;
        this.canvas.height = (this.z2 - this.z1) * this.ppm + 2 * this.padding;

        this._events = new Map();
        this._eventDrawConfig = config.EVENT_DRAW;
        this._eventClasses = { light: EventLight, master: EventMaster };
    }

    setFixtures(fixtures) {
        this.fixtures = fixtures;
    }

    handleEvent(event) {
        const EventClass = this._eventClasses[event.class];
        if (!EventClass) return;
        const layer = event.params?.layer ?? 0;
        this._events.set(layer, new EventClass(event, this._eventDrawConfig));
    }

    start() {
        const loop = () => {
            this.draw();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    draw() {
        const { ctx, canvas } = this;
        const nowSec = performance.now() / 1000;

        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        this._drawGrid();

        for (const fixture of this.fixtures) {
            fixture.update(nowSec);
            const { cx, cy } = this.worldToCanvas(fixture.location[0], fixture.location[2]);
            fixture.draw(ctx, cx, cy, this.ppm);
        }

        for (const [, ev] of this._events) {
            const { cx, cy } = this.worldToCanvas(ev.position[0], ev.position[2]);
            ev.draw(ctx, cx, cy, this.ppm);
        }
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
