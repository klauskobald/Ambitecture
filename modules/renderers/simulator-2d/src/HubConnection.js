class HubConnection {
    constructor(config, renderer) {
        this.config = config;
        this.ws = null;

        const configHandler = new ConfigHandler(renderer, config);
        const eventsHandler = new EventsHandler(configHandler, renderer);
        configHandler.setOnConfigApplied(() => eventsHandler.reapplyCurrentIntents());

        this.handlers = {
            config: configHandler,
            events: eventsHandler,
        };
    }

    connect() {
        const wsUrl = this.config.AMBITECTURE_HUB_URL.replace(/^http/, 'ws');
        this._setStatus(`connecting to ${wsUrl}…`);

        const ws = new WebSocket(wsUrl);
        this.ws = ws;

        ws.onopen = () => {
            this._setStatus('connected');
            this._sendRegister(ws);
        };

        ws.onmessage = evt => this._handleRaw(evt.data);

        ws.onclose = () => {
            this._setStatus('disconnected — reconnecting…');
            setTimeout(() => this.connect(), 1000);
        };

        ws.onerror = () => ws.close();
    }

    _handleRaw(raw) {
        let envelope;
        try { envelope = JSON.parse(raw); } catch { return; }

        const message = envelope?.message;
        if (!message?.type) return;

        const handler = this.handlers[message.type];
        if (handler) {
            handler.handle(message);
            this.renderer.markRenderActivity();
        }
    }

    _sendRegister(ws) {
        const [geoLon, geoLat] = this.config.GEO_LOCATION.split(' ').map(Number);

        ws.send(JSON.stringify({
            message: {
                type: 'register',
                location: [geoLon, geoLat],
                payload: {
                    role: 'renderer',
                    guid: this.config.GUID,
                },
            },
        }));
    }

    _setStatus(text) {
        const el = document.getElementById('status');
        if (el) el.textContent = text;
    }
}
