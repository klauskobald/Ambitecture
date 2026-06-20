import { LifecycleHud } from './LifecycleHud.js';

const RECONNECT_DELAY_MS = 1000;

function parseGeoLocation(raw) {
  if (typeof raw !== 'string') return [0, 0];
  const [lon, lat] = raw.split(/\s+/).map(Number);
  return [Number.isFinite(lon) ? lon : 0, Number.isFinite(lat) ? lat : 0];
}

function toWsUrl(httpUrl) {
  return String(httpUrl).replace(/^http/i, 'ws');
}

function shortUrl(wsUrl) {
  const s = String(wsUrl);
  return s.length > 36 ? `${s.slice(0, 34)}…` : s;
}

function shortErr(err) {
  const t = err instanceof Error ? err.message : String(err);
  return t.length > 48 ? `${t.slice(0, 46)}…` : t;
}

/**
 * @typedef {{ onConfig?: (payload: unknown) => void; onEvents?: (payload: unknown) => void }} HubMessageCallbacks
 */

export class HubConnection {
  /**
   * @param {Record<string, unknown>} config
   * @param {LifecycleHud} hud
   * @param {HubMessageCallbacks} [messageCallbacks]
   */
  constructor(config, hud, messageCallbacks = {}) {
    this._config = config;
    this._hud = hud;
    this._callbacks = messageCallbacks;
    this._ws = null;
    this._stopped = false;
    this._reconnectTimer = null;
  }

  connect() {
    if (this._stopped) return;
    const wsUrl = toWsUrl(String(this._config.AMBITECTURE_HUB_URL ?? ''));
    this.onConnecting(wsUrl);

    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      this.onError(err);
      this._scheduleReconnect();
      return;
    }
    this._ws = ws;

    ws.addEventListener('open', () => this._handleOpen());
    ws.addEventListener('message', evt => this._handleRaw(evt.data));
    ws.addEventListener('close', evt => this._handleClose(evt));
    ws.addEventListener('error', evt => this.onError(evt));
  }

  disconnect() {
    this._stopped = true;
    this._hud.clear();
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }

  send(type, payload) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      console.warn(`[screen] cannot send "${type}" — socket not open`);
      return false;
    }
    const [lon, lat] = parseGeoLocation(this._config.GEO_LOCATION);
    const envelope = { message: { type, location: [lon, lat], payload } };
    this._ws.send(JSON.stringify(envelope));
    return true;
  }

  _handleOpen() {
    this.onOpen();
    const payload = { role: 'renderer', type: 'screen', guid: this._config.GUID, subscribe: { events: false, fixtureState: true } };
    const ok = this.send('register', payload);
    if (ok) this.onRegisterSent(payload);
  }

  _handleRaw(raw) {
    let envelope;
    try {
      envelope = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
    } catch (err) {
      this.onError(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const message = envelope?.message;
    if (!message || typeof message.type !== 'string') {
      console.warn('[screen] malformed envelope', envelope);
      this._hud.showEphemeral('Bad message', '', 'warn');
      return;
    }
    this.onMessage(message);
  }

  _handleClose(evt) {
    this._ws = null;
    this.onClose(evt);
    if (!this._stopped) {
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this._stopped || this._reconnectTimer !== null) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.onReconnect(RECONNECT_DELAY_MS);
      this.connect();
    }, RECONNECT_DELAY_MS);
  }

  onBoot() {
    this._hud.showEphemeral('Starting', '', 'boot');
  }

  onConfigLoaded(cfg) {
    const name = String(cfg.NAME ?? '').trim() || 'Screen';
    this._hud.showEphemeral('Ready', name, 'boot');
  }

  onConnecting(wsUrl) {
    this._hud.showEphemeral('Connecting…', shortUrl(wsUrl), 'connecting');
  }

  onOpen() {}

  onRegisterSent(_payload) {
    this._hud.showEphemeral('Connected', '', 'registered');
  }

  onMessage(message) {
    switch (message.type) {
      case 'config':
        this.onConfig(message.payload);
        this._callbacks.onConfig?.(message.payload);
        break;
      case 'fixtureState':
        this._callbacks.onFixtureState?.(message.payload);
        break;
      case 'systemCapabilities':
        this.onSystemCapabilities(message.payload);
        break;
      default:
        this.onUnknownMessage(message);
        break;
    }
  }

  onConfig(_payload) {
    this._hud.showEphemeral('Got config', '', 'live');
  }

  onSystemCapabilities(_payload) {}

  onUnknownMessage(message) {
    console.warn('[screen] unhandled message', message.type, message);
    this._hud.showEphemeral('Unknown message', String(message.type), 'warn');
  }

  onClose(evt) {
    const code = evt?.code != null && evt.code !== 1000 ? `code ${evt.code}` : '';
    this._hud.showEphemeral('Lost connection', code, 'closed');
  }

  onError(err) {
    const detail = shortErr(err);
    console.error('[screen]', detail);
    this._hud.showEphemeral('Error', detail, 'failed');
  }

  onReconnect(_delayMs) {
    this._hud.showEphemeral('Reconnecting…', '', 'reconnecting');
  }
}
