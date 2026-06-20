const RECONNECT_DELAY_MS = 1000;
const MAX_LOG_LINES = 500;

const LOG_LEVELS = {
  info: 'info',
  warn: 'warn',
  error: 'error',
  recv: 'recv',
  send: 'send',
};

class UiLog {
  constructor(listEl, statusEls) {
    this._list = listEl;
    this._status = statusEls;
  }

  setIdentity(name, guid) {
    if (this._status.name) this._status.name.textContent = name ?? '—';
    if (this._status.guid) this._status.guid.textContent = guid ?? '—';
  }

  setState(state) {
    const el = this._status.state;
    if (!el) return;
    el.textContent = state;
    el.dataset['state'] = state;
  }

  log(level, msg, data) {
    const stamp = new Date().toISOString().slice(11, 23);
    const tag = `[${stamp}] [${level}]`;

    switch (level) {
      case LOG_LEVELS.error:
        console.error(tag, msg, data ?? '');
        break;
      case LOG_LEVELS.warn:
        console.warn(tag, msg, data ?? '');
        break;
      default:
        console.log(tag, msg, data ?? '');
        break;
    }

    if (!this._list) return;
    const li = document.createElement('li');
    li.className = `log-line log-line--${level}`;
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = stamp;
    const lvl = document.createElement('span');
    lvl.className = 'log-level';
    lvl.textContent = level;
    const text = document.createElement('span');
    text.className = 'log-msg';
    text.textContent = msg;
    li.append(time, lvl, text);
    if (data !== undefined) {
      const pre = document.createElement('pre');
      pre.className = 'log-data';
      pre.textContent = typeof data === 'string' ? data : safeStringify(data);
      li.appendChild(pre);
    }
    this._list.appendChild(li);

    while (this._list.childElementCount > MAX_LOG_LINES) {
      this._list.removeChild(this._list.firstChild);
    }
    li.scrollIntoView({ block: 'end' });
  }
}

function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseGeoLocation(raw) {
  if (typeof raw !== 'string') return [0, 0];
  const [lon, lat] = raw.split(/\s+/).map(Number);
  return [Number.isFinite(lon) ? lon : 0, Number.isFinite(lat) ? lat : 0];
}

function toWsUrl(httpUrl) {
  return String(httpUrl).replace(/^http/i, 'ws');
}

class HubConnection {
  constructor(config, log) {
    this._config = config;
    this._log = log;
    this._ws = null;
    this._stopped = false;
    this._reconnectTimer = null;
  }

  connect() {
    if (this._stopped) return;
    const wsUrl = toWsUrl(this._config.AMBITECTURE_HUB_URL);
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
      this._log.log(LOG_LEVELS.warn, `cannot send "${type}" — socket not open`);
      return false;
    }
    const [lon, lat] = parseGeoLocation(this._config.GEO_LOCATION);
    const envelope = { message: { type, location: [lon, lat], payload } };
    this._ws.send(JSON.stringify(envelope));
    return true;
  }

  _handleOpen() {
    this.onOpen();
    const payload = { role: 'renderer', type: 'starter-web-app', guid: this._config.GUID, subscribe: { events: true } };
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
      this._log.log(LOG_LEVELS.warn, 'received malformed envelope', envelope);
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
    this.onReconnect(RECONNECT_DELAY_MS);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }

  // ─── Lifecycle hooks ─────────────────────────────────────────────────────
  // Override these in a subclass to react to hub traffic. Default impls log
  // to the console and to the on-page log panel — no rendering, no state.

  onBoot() {
    this._log.setState('boot');
    this._log.log(LOG_LEVELS.info, 'boot');
  }

  onConfigLoaded(cfg) {
    this._log.setIdentity(cfg.NAME, cfg.GUID);
    this._log.log(LOG_LEVELS.info, 'config.json loaded', {
      hub: cfg.AMBITECTURE_HUB_URL,
      name: cfg.NAME,
      guid: cfg.GUID,
      geoLocation: cfg.GEO_LOCATION,
    });
  }

  onConnecting(wsUrl) {
    this._log.setState('connecting');
    this._log.log(LOG_LEVELS.info, `connecting to ${wsUrl}`);
  }

  onOpen() {
    this._log.setState('open');
    this._log.log(LOG_LEVELS.info, 'socket open');
  }

  onRegisterSent(payload) {
    this._log.setState('registered');
    this._log.log(LOG_LEVELS.send, 'register sent', payload);
  }

  onMessage(message) {
    this._log.log(LOG_LEVELS.recv, `← ${message.type}`);
    switch (message.type) {
      case 'config':
        this.onConfig(message.payload);
        break;
      case 'events':
        this.onEvents(message.payload);
        break;
      case 'systemCapabilities':
        this.onSystemCapabilities(message.payload);
        break;
      default:
        this.onUnknownMessage(message);
        break;
    }
  }

  onConfig(payload) {
    const zoneCount = Array.isArray(payload?.zones) ? payload.zones.length : 0;
    const fixtureCount = Array.isArray(payload?.zones)
      ? payload.zones.reduce((n, z) => n + (Array.isArray(z?.fixtures) ? z.fixtures.length : 0), 0)
      : 0;
    this._log.log(LOG_LEVELS.info, `config: ${zoneCount} zone(s), ${fixtureCount} fixture(s)`, payload);
  }

  onEvents(payload) {
    const count = Array.isArray(payload) ? payload.length : 0;
    this._log.log(LOG_LEVELS.info, `events: ${count}`, payload);
  }

  onSystemCapabilities(payload) {
    this._log.log(LOG_LEVELS.info, 'systemCapabilities', payload);
  }

  onUnknownMessage(message) {
    this._log.log(LOG_LEVELS.warn, `unhandled message "${message.type}"`, message);
  }

  onClose(evt) {
    this._log.setState('closed');
    this._log.log(LOG_LEVELS.warn, `socket closed${evt?.code ? ` (code ${evt.code})` : ''}`);
  }

  onError(err) {
    const detail = err instanceof Error ? err.message : (err && err.type) || String(err);
    this._log.log(LOG_LEVELS.error, `socket error: ${detail}`);
  }

  onReconnect(delayMs) {
    this._log.setState('reconnecting');
    this._log.log(LOG_LEVELS.info, `reconnecting in ${delayMs}ms`);
  }
}

async function boot() {
  const log = new UiLog(
    document.getElementById('log-list'),
    {
      name: document.getElementById('status-name'),
      guid: document.getElementById('status-guid'),
      state: document.getElementById('status-state'),
    },
  );

  const hub = new HubConnection({}, log);
  hub.onBoot();

  let config;
  try {
    const resp = await fetch('./config.json', { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    config = await resp.json();
  } catch (err) {
    log.setState('failed');
    log.log(LOG_LEVELS.error, 'failed to load config.json', err instanceof Error ? err.message : String(err));
    return;
  }

  hub._config = config;
  hub.onConfigLoaded(config);
  hub.connect();

  window.addEventListener('beforeunload', () => hub.disconnect());
}

boot();
