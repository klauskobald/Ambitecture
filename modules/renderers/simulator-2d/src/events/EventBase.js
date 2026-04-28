class EventBase {
    constructor(intent, drawConfig) {
        this._layer = intent.layer ?? 0;
        this._position = intent.position ?? [0, 0, 0];
        this._payload = intent.payload ?? {};
        this._drawConfig = drawConfig;
    }

    get position() { return this._position; }

    draw(_ctx, _cx, _cy, _ppm) {
        throw new Error(`${this.constructor.name} must implement draw()`);
    }
}
