class EventBase {
    constructor(event, drawConfig) {
        this._layer    = event.params?.layer ?? 0;
        this._position = event.position ?? [0, 0, 0];
        this._drawConfig = drawConfig;
    }

    get position() { return this._position; }

    draw(_ctx, _cx, _cy, _ppm) {
        throw new Error(`${this.constructor.name} must implement draw()`);
    }
}
