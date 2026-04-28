class LightBase {
    constructor(profile, instanceConfig, drawConfig) {
        this.name = instanceConfig.name;
        this.location = instanceConfig.location;
        this.range = instanceConfig.range;
        this.fixtureProfile = profile;
        this._strobeConfig = drawConfig.strobe;
        this._nowSec = 0;
    }

    update(nowSec) {
        this._nowSec = nowSec;
    }

    draw(_ctx, _cx, _cy, _ppm) {
        throw new Error(`${this.constructor.name} must implement draw()`);
    }

    applyIntentSnapshot(_context, _snapshot) {
        throw new Error(`${this.constructor.name} must implement applyIntentSnapshot()`);
    }

    _isStrobeOn(strobeValue) {
        if (!strobeValue || strobeValue === 0) return true;
        const { lowFrequency, highFrequency, onTime } = this._strobeConfig;
        const freq = lowFrequency + strobeValue * (highFrequency - lowFrequency);
        const period = 1 / freq;
        return (this._nowSec % period) < onTime;
    }
}
