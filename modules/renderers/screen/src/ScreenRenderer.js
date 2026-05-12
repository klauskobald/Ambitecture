export class ScreenRenderer {
  /**
   * @param {HTMLCanvasElement} canvasEl
   */
  constructor(canvasEl) {
    this.canvas = canvasEl;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) {
      throw new Error('ScreenRenderer: canvas 2d context unavailable');
    }
    this.ctx = ctx;
    this.fixtures = [];
    /** @type {number | null} */
    this._rafId = null;
    this._boundFrame = this._frame.bind(this);
    this._boundResize = this._resize.bind(this);
    /** @type {ResizeObserver | null} */
    this._ro = null;
  }

  setFixtures(fixtures) {
    this.fixtures = fixtures;
  }

  start() {
    this._resize();
    window.addEventListener('resize', this._boundResize);
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this.canvas);
    if (this._rafId === null) {
      this._rafId = requestAnimationFrame(this._boundFrame);
    }
  }

  stop() {
    window.removeEventListener('resize', this._boundResize);
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  markRenderActivity() {}

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * @param {number} nowMs
   */
  _frame(nowMs) {
    this._rafId = requestAnimationFrame(this._boundFrame);
    const nowSec = nowMs / 1000;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const { ctx } = this;

    if (this.fixtures.length === 0) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      return;
    }

    for (const fixture of this.fixtures) {
      fixture.update(nowSec);
      fixture.draw(ctx, w, h, nowSec);
    }
  }
}
