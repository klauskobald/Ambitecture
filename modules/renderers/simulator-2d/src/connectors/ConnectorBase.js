class ConnectorBase {
    static _kinds = new Map();

    static registerKind(kind, connectorClass) {
        this._kinds.set(kind, connectorClass);
    }

    static getKind(kind) {
        return this._kinds.get(kind);
    }

    constructor(record, drawConfig) {
        this._record = record;
        this._drawConfig = drawConfig ?? {};
    }

    get aGuid() { return this._record.aGuid; }
    get bGuid() { return this._record.bGuid; }

    draw(_ctx, _ax, _ay, _bx, _by) {
        throw new Error(`${this.constructor.name} must implement draw()`);
    }
}
