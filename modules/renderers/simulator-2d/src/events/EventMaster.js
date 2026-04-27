class EventMaster extends EventBase {
    constructor(event, drawConfig) {
        super(event, drawConfig);
        console.log('[EventMaster]', event);
    }

    draw(_ctx, _cx, _cy, _ppm) {}
}
