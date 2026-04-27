const DmxLightStatic = {
    handleEvent(event, fixture) {
        switch (event.class) {
            case 'light':  this._handleLight(event, fixture);  break;
            case 'master': this._handleMaster(event, fixture); break;
        }
    },

    _handleLight(event, fixture) {
        const colorData = event.params?.color;
        if (!colorData) return;
        fixture._rawColor = Color.fromXYY(colorData).toRGB();
        if (event.params?.strobe !== undefined) fixture._strobe = event.params.strobe;
        this._applyMaster(fixture);
    },

    _handleMaster(event, fixture) {
        if (event.params?.brightness !== undefined) fixture._masterBrightness = event.params.brightness;
        if (event.params?.blackout   !== undefined) fixture._masterBlackout   = event.params.blackout;
        this._applyMaster(fixture);
    },

    _applyMaster(fixture) {
        if (!fixture._rawColor) return;
        const { r, g, b } = fixture._rawColor;
        const mb = fixture._masterBrightness ?? 1;
        const bo = fixture._masterBlackout   ?? false;
        fixture.currentColor = bo
            ? { r: 0, g: 0, b: 0 }
            : { r: r * mb, g: g * mb, b: b * mb };
    },
};
