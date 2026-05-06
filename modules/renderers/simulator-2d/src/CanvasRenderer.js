class CanvasRenderer {
    constructor(canvasEl, bootConfig) {
        this.canvas = canvasEl;
        this.ctx = canvasEl.getContext('2d');
        this.fixtures = [];
        this.x1 = 0;
        this.y1 = 0;
        this.z1 = 0;
        this.x2 = 1;
        this.y2 = 1;
        this.z2 = 1;
        this.ppm = 1;
        this._spatialReady = false;

        this.canvas.width = 1;
        this.canvas.height = 1;

        const ppmRaw = bootConfig.PIXEL_PER_METER;
        this.ppm =
            typeof ppmRaw === 'number' && Number.isFinite(ppmRaw) && ppmRaw > 0 ? ppmRaw : 50;

        this._events = new Map();
        this._eventDrawConfig = bootConfig.EVENT_DRAW;

        /** @type {number | null} */
        this._rafId = null;
        this._lastRenderActivityMs = 0;
        this._inactivityStopMs = 1000;
    }

    /** Resets the idle timer and ensures the rAF loop is running. */
    markRenderActivity() {
        this._lastRenderActivityMs = performance.now();
        if (this._rafId === null) {
            this._rafId = requestAnimationFrame(() => this._runFrame());
        }
    }

    _runFrame() {
        this._rafId = null;
        this.draw();
        const idleMs = performance.now() - this._lastRenderActivityMs;
        if (idleMs < this._inactivityStopMs) {
            this._rafId = requestAnimationFrame(() => this._runFrame());
        }
    }

    /**
     * Hub zones supply boundingBox only; canvas pixel size = bbox span × local PIXEL_PER_METER (no padding).
     * @param {unknown} zones hub config zones
     */
    setSpatialFromZones(zones) {
        if (!Array.isArray(zones) || zones.length === 0) {
            console.warn('[CanvasRenderer] setSpatialFromZones: no zones');
            return;
        }
        const validZones = zones.filter(
            z => z && typeof z === 'object' && Array.isArray(z.boundingBox) && z.boundingBox.length >= 6
        );
        if (validZones.length === 0) {
            console.warn('[CanvasRenderer] setSpatialFromZones: no boundingBox on zones');
            return;
        }
        this._zones = validZones.map(z => ({ name: z.name, bbox: z.boundingBox.map(Number) }));
        const u = CanvasRenderer._unionBoundingBoxes(this._zones.map(z => z.bbox));
        this.x1 = u[0];
        this.y1 = u[1];
        this.z1 = u[2];
        this.x2 = u[3];
        this.y2 = u[4];
        this.z2 = u[5];

        this.canvas.width = (this.x2 - this.x1) * this.ppm;
        this.canvas.height = (this.z2 - this.z1) * this.ppm;
        this._spatialReady = true;
    }

    /**
     * @param {number[][]} boxes
     * @returns {number[]}
     */
    static _unionBoundingBoxes(boxes) {
        let x1 = Infinity;
        let y1 = Infinity;
        let z1 = Infinity;
        let x2 = -Infinity;
        let y2 = -Infinity;
        let z2 = -Infinity;
        for (const b of boxes) {
            x1 = Math.min(x1, b[0]);
            y1 = Math.min(y1, b[1]);
            z1 = Math.min(z1, b[2]);
            x2 = Math.max(x2, b[3]);
            y2 = Math.max(y2, b[4]);
            z2 = Math.max(z2, b[5]);
        }
        return [x1, y1, z1, x2, y2, z2];
    }

    setFixtures(fixtures) {
        this.fixtures = fixtures;
    }

    setIntentLayers(intentsByLayer) {
        this._events = new Map();
        for (const [guid, intent] of intentsByLayer) {
            const EventClass = EventBase.getClass(intent.intentType);
            if (!EventClass) continue;
            this._events.set(guid, new EventClass(intent, this._eventDrawConfig));
        }
    }

    start() {
        this.draw();
    }

    draw() {
        const { ctx, canvas } = this;
        const nowSec = performance.now() / 1000;

        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (!this._spatialReady) {
            ctx.fillStyle = '#555';
            ctx.font = '12px monospace';
            ctx.fillText('waiting for hub config…', 8, 20);
            return;
        }

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
            cx: (wx - this.x1) * this.ppm,
            cy: (wz - this.z1) * this.ppm,
        };
    }

    _drawGrid() {
        for (const zone of this._zones) {
            this._drawZoneGrid(zone);
        }
    }

    _drawZoneGrid(zone) {
        const { ctx, ppm, x1, z1 } = this;
        const [zx1, , zz1, zx2, , zz2] = zone.bbox;

        const px1 = (zx1 - x1) * ppm;
        const pz1 = (zz1 - z1) * ppm;
        const pw  = (zx2 - zx1) * ppm;
        const ph  = (zz2 - zz1) * ppm;

        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1;
        for (let x = Math.ceil(zx1); x <= zx2; x++) {
            const cx = (x - x1) * ppm;
            ctx.beginPath();
            ctx.moveTo(cx, pz1);
            ctx.lineTo(cx, pz1 + ph);
            ctx.stroke();
        }
        for (let z = Math.ceil(zz1); z <= zz2; z++) {
            const cy = (z - z1) * ppm;
            ctx.beginPath();
            ctx.moveTo(px1, cy);
            ctx.lineTo(px1 + pw, cy);
            ctx.stroke();
        }

        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.strokeRect(px1, pz1, pw, ph);

        ctx.fillStyle = '#444';
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(zone.name, px1 + 4, pz1 + 14);
    }
}
