/**
 * @typedef {object} LayoutConfig
 * @property {number} pagePaddingPx
 * @property {number} mainGapPx
 * @property {number} simStackMinHeightVh
 * @property {number} controlStripMinHeightPx
 * @property {number} iframeZIndex
 * @property {number} overlayZIndex
 * @property {number} overlayFingerRadiusPx
 * @property {string} overlayFingerFillRgba
 * @property {string} overlayFingerStrokeRgba
 * @property {number} overlayLineWidthPx
 * @property {number} overlayTrailFadeMs
 */

/**
 * Zone bounding box in meters (hub `config`); the touch overlay maps linearly to XZ over its client rect.
 * @typedef {object} HubSpatialState
 * @property {number} x1
 * @property {number} y1
 * @property {number} z1
 * @property {number} x2
 * @property {number} y2
 * @property {number} z2
 */

const REQUIRED_LAYOUT_KEYS = /** @type {(keyof LayoutConfig)[]} */ ([
  'pagePaddingPx',
  'mainGapPx',
  'simStackMinHeightVh',
  'controlStripMinHeightPx',
  'iframeZIndex',
  'overlayZIndex',
  'overlayFingerRadiusPx',
  'overlayFingerFillRgba',
  'overlayFingerStrokeRgba',
  'overlayLineWidthPx',
  'overlayTrailFadeMs',
]);

/**
 * @param {unknown} cfg
 * @returns {cfg is { SIMULATOR_IFRAME_URL: string, AMBITECTURE_HUB_URL: string, GEO_LOCATION: string, CONTROLLER_GUID: string, SIMULATOR_RENDERER_GUID: string, LAYOUT: LayoutConfig }}
 */
function validateControllerConfig(cfg) {
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return false;
  }
  const o = /** @type {Record<string, unknown>} */ (cfg);
  if (typeof o.SIMULATOR_IFRAME_URL !== 'string' || o.SIMULATOR_IFRAME_URL.trim() === '') {
    return false;
  }
  if (typeof o.AMBITECTURE_HUB_URL !== 'string' || o.AMBITECTURE_HUB_URL.trim() === '') {
    return false;
  }
  if (typeof o.GEO_LOCATION !== 'string' || o.GEO_LOCATION.trim() === '') {
    return false;
  }
  if (typeof o.CONTROLLER_GUID !== 'string' || o.CONTROLLER_GUID.trim() === '') {
    return false;
  }
  if (typeof o.SIMULATOR_RENDERER_GUID !== 'string' || o.SIMULATOR_RENDERER_GUID.trim() === '') {
    return false;
  }
  const layout = o.LAYOUT;
  if (layout === null || typeof layout !== 'object' || Array.isArray(layout)) {
    return false;
  }
  const L = /** @type {Record<string, unknown>} */ (layout);
  for (const key of REQUIRED_LAYOUT_KEYS) {
    if (!(key in L)) {
      return false;
    }
    const v = L[key];
    if (key === 'overlayFingerFillRgba' || key === 'overlayFingerStrokeRgba') {
      if (typeof v !== 'string' || v.trim() === '') {
        return false;
      }
    } else if (typeof v !== 'number' || !Number.isFinite(v)) {
      return false;
    }
  }
  return true;
}

/**
 * @param {LayoutConfig} L
 */
function applyLayoutCssVars(L) {
  const root = document.documentElement;
  root.style.setProperty('--page-padding', `${L.pagePaddingPx}px`);
  root.style.setProperty('--main-gap', `${L.mainGapPx}px`);
  root.style.setProperty('--sim-stack-min-height', `${L.simStackMinHeightVh}vh`);
  root.style.setProperty('--control-strip-min-height', `${L.controlStripMinHeightPx}px`);
  root.style.setProperty('--iframe-z-index', String(L.iframeZIndex));
  root.style.setProperty('--overlay-z-index', String(L.overlayZIndex));
}

/**
 * @param {string} message
 */
function showConfigError(message) {
  const el = document.getElementById('config-error');
  if (!el) {
    console.error('web-test:', message);
    return;
  }
  el.textContent = message;
  el.hidden = false;
  console.error('web-test:', message);
}

/**
 * @param {string} text
 */
function setSpatialReadout(text) {
  const el = document.getElementById('spatial-readout');
  if (!el) {
    return;
  }
  el.textContent = text;
  el.hidden = text === '';
}

/**
 * @param {unknown} payload
 * @param {string} rendererGuid
 * @returns {HubSpatialState | null}
 */
function spatialStateFromControllerConfig(payload, rendererGuid) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const p = /** @type {Record<string, unknown>} */ (payload);
  const zones = p.zones;
  if (!Array.isArray(zones)) {
    return null;
  }
  const zoneToRenderer = /** @type {Record<string, string[]>} */ (p.zoneToRenderer ?? {});
  /** @type {number[][]} */
  const matched = [];
  for (const z of zones) {
    if (z === null || typeof z !== 'object' || Array.isArray(z)) {
      continue;
    }
    const zone = /** @type {Record<string, unknown>} */ (z);
    const zoneName = /** @type {string} */ (zone.name);
    const assignedRenderers = zoneToRenderer[zoneName];
    if (!Array.isArray(assignedRenderers) || !assignedRenderers.includes(rendererGuid)) {
      continue;
    }
    const bb = zone.boundingBox;
    if (!Array.isArray(bb) || bb.length < 6) {
      continue;
    }
    matched.push(bb.map((n) => Number(n)));
  }
  if (matched.length === 0) {
    return null;
  }
  let x1 = Infinity;
  let y1 = Infinity;
  let z1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  let z2 = -Infinity;
  for (const b of matched) {
    x1 = Math.min(x1, b[0]);
    y1 = Math.min(y1, b[1]);
    z1 = Math.min(z1, b[2]);
    x2 = Math.max(x2, b[3]);
    y2 = Math.max(y2, b[4]);
    z2 = Math.max(z2, b[5]);
  }
  return {
    x1,
    y1,
    z1,
    x2,
    y2,
    z2,
  };
}

/**
 * @param {unknown} payload
 * @param {string} rendererGuid
 * @returns {number[][]}
 */
function zoneBoundingBoxesFromControllerConfig(payload, rendererGuid) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return [];
  }
  const p = /** @type {Record<string, unknown>} */ (payload);
  const zones = p.zones;
  if (!Array.isArray(zones)) {
    return [];
  }
  const zoneToRenderer = /** @type {Record<string, string[]>} */ (p.zoneToRenderer ?? {});
  /** @type {number[][]} */
  const matched = [];
  for (const z of zones) {
    if (z === null || typeof z !== 'object' || Array.isArray(z)) {
      continue;
    }
    const zone = /** @type {Record<string, unknown>} */ (z);
    const zoneName = /** @type {string} */ (zone.name);
    const assignedRenderers = zoneToRenderer[zoneName];
    if (!Array.isArray(assignedRenderers) || !assignedRenderers.includes(rendererGuid)) {
      continue;
    }
    const bb = zone.boundingBox;
    if (!Array.isArray(bb) || bb.length < 6) {
      continue;
    }
    matched.push(bb.map((n) => Number(n)));
  }
  return matched;
}

/**
 * @param {number[]} position
 * @param {number[][]} zoneBoxes
 * @returns {boolean}
 */
function isPositionInsideAnyZone(position, zoneBoxes) {
  return zoneBoxes.some((zone) =>
    position[0] >= zone[0] && position[0] <= zone[3]
    && position[1] >= zone[1] && position[1] <= zone[4]
    && position[2] >= zone[2] && position[2] <= zone[5]
  );
}

/**
 * Map viewport `clientX`/`clientY` to meters using the touch-overlay canvas client rect and zone bbox (linear XZ).
 * @param {number} clientX
 * @param {number} clientY
 * @param {HTMLCanvasElement} overlayCanvas `#touch-overlay` (covers `.sim-stack`)
 * @param {HubSpatialState} s
 * @returns {{ wx: number; wy: number; wz: number; nx: number; ny: number } | null}
 */
function overlayClientToBboxMeters(clientX, clientY, overlayCanvas, s) {
  const r = overlayCanvas.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) {
    return null;
  }
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) {
    return null;
  }
  const nx = (clientX - r.left) / r.width;
  const ny = (clientY - r.top) / r.height;
  const wx = s.x1 + nx * (s.x2 - s.x1);
  const wz = s.z1 + ny * (s.z2 - s.z1);
  const wy = s.y1;
  return { wx, wy, wz, nx, ny };
}

/**
 * @param {LayoutConfig} L
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} stack
 * @param {() => HubSpatialState | null} getSpatial
 * @param {() => number[][]} getZoneBoxes
 * @param {() => Map<number, unknown>} getIntents
 * @param {(layer: number, wx: number, wz: number) => void} onIntentDrag
 * @param {HTMLIFrameElement} iframe
 */
function setupOverlayCanvas(L, canvas, stack, getSpatial, getZoneBoxes, getIntents, onIntentDrag, iframe) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    showConfigError('Canvas 2D context unavailable.');
    return;
  }

  /** @type {{ x: number; y: number; t: number }[]} */
  const samples = [];

  /** @type {Set<number>} */
  const activePointers = new Set();
  /** @type {Map<number, string>} pointerId → intent guid */
  const draggedPointers = new Map();
  const DRAG_HIT_RADIUS_PX = 28;

  function getSimCanvasRect() {
    const simCanvas = iframe.contentDocument?.getElementById('sim-canvas');
    if (!simCanvas) return null;
    const inner = simCanvas.getBoundingClientRect();
    const outer = iframe.getBoundingClientRect();
    return new DOMRect(
      outer.left + inner.left,
      outer.top + inner.top,
      inner.width,
      inner.height
    );
  }

  function findIntentAtCanvas(cx, cy, spatial) {
    const intents = getIntents();
    const simRect = getSimCanvasRect();
    if (!simRect) return null;
    const overlayRect = canvas.getBoundingClientRect();
    const alreadyGrabbed = new Set(draggedPointers.values());
    let nearest = null;
    let nearestDist = DRAG_HIT_RADIUS_PX;
    for (const [guid, intent] of intents) {
      if (alreadyGrabbed.has(guid)) continue;
      const i = /** @type {Record<string, unknown>} */ (intent);
      const pos = /** @type {number[]} */ (i.position);
      if (!pos) continue;
      const { px, py } = worldToCanvas(pos[0], pos[2], spatial, simRect, overlayRect);
      const dist = Math.hypot(cx - px, cy - py);
      if (dist < nearestDist) { nearest = guid; nearestDist = dist; }
    }
    return nearest;
  }

  function resizeCanvas() {
    const rect = stack.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const ro = new ResizeObserver(() => {
    resizeCanvas();
  });
  ro.observe(stack);
  resizeCanvas();

  function canvasPointFromEvent(ev) {
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    return { x, y };
  }

  function pushSample(clientX, clientY, x, y) {
    samples.push({ x, y, t: performance.now() });
    const spatial = getSpatial();
    if (!spatial) {
      setSpatialReadout('hub config (zone bbox) not yet received');
      return;
    }
    const m = overlayClientToBboxMeters(clientX, clientY, canvas, spatial);
    if (!m) {
      setSpatialReadout('outside touch overlay');
      return;
    }
    const { wx, wy, wz, nx, ny } = m;
    setSpatialReadout(
      `overlay u=${nx.toFixed(3)} v=${ny.toFixed(3)}  |  meters x=${wx.toFixed(3)} y=${wy.toFixed(3)} z=${wz.toFixed(3)}`
    );
  }

  function onPointerDown(ev) {
    if (ev.button !== undefined && ev.button !== 0) return;
    const { x, y } = canvasPointFromEvent(ev);
    const spatial = getSpatial();
    if (spatial) {
      const hit = findIntentAtCanvas(x, y, spatial);
      if (hit !== null) {
        draggedPointers.set(ev.pointerId, hit);
        activePointers.add(ev.pointerId);
        try { canvas.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
        return;
      }
    }
    activePointers.add(ev.pointerId);
    try { canvas.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
    pushSample(ev.clientX, ev.clientY, x, y);
  }

  function onPointerMove(ev) {
    if (!activePointers.has(ev.pointerId)) return;
    const guid = draggedPointers.get(ev.pointerId);
    if (guid !== undefined) {
      const spatial = getSpatial();
      const simRect = getSimCanvasRect();
      if (!spatial || !simRect) return;
      const m = clientToWorldViaSimCanvas(ev.clientX, ev.clientY, spatial, simRect);
      if (!m) return;
      onIntentDrag(guid, m.wx, m.wz);
      return;
    }
    const { x, y } = canvasPointFromEvent(ev);
    pushSample(ev.clientX, ev.clientY, x, y);
  }

  function onPointerUp(ev) {
    activePointers.delete(ev.pointerId);
    draggedPointers.delete(ev.pointerId);
    try { canvas.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  function frame(now) {
    requestAnimationFrame(frame);
    const fadeMs = L.overlayTrailFadeMs;
    while (samples.length > 0 && now - samples[0].t > fadeMs) {
      samples.shift();
    }
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    const r = L.overlayFingerRadiusPx;
    ctx.lineWidth = L.overlayLineWidthPx;
    ctx.strokeStyle = L.overlayFingerStrokeRgba;
    ctx.fillStyle = L.overlayFingerFillRgba;
    for (const s of samples) {
      const age = now - s.t;
      const a = 1 - age / fadeMs;
      if (a <= 0) {
        continue;
      }
      ctx.globalAlpha = Math.min(1, Math.max(0, a));
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (draggedPointers.size > 0) {
      const spatial = getSpatial();
      const simRect = getSimCanvasRect();
      if (spatial && simRect) {
        for (const guid of draggedPointers.values()) {
          const draggedIntent = getIntents().get(guid);
          if (!draggedIntent) continue;
          const i = /** @type {Record<string, unknown>} */ (draggedIntent);
          const pos = /** @type {number[]} */ (i.position);
          if (!pos) continue;
          const { px, py } = worldToCanvas(pos[0], pos[2], spatial, simRect, rect);
          ctx.save();
          ctx.beginPath();
          ctx.arc(px, py, L.overlayFingerRadiusPx * 1.4, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255, 220, 80, 0.9)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = 'rgba(255, 220, 80, 0.25)';
          ctx.fill();
          ctx.restore();
        }
      }
    }

    const spatial = getSpatial();
    const simRect = getSimCanvasRect();
    if (spatial && simRect) {
      const zoneBoxes = getZoneBoxes();
      for (const intent of getIntents().values()) {
        const i = /** @type {Record<string, unknown>} */ (intent);
        const pos = /** @type {number[] | undefined} */ (i.position);
        if (!pos || pos.length < 3) {
          continue;
        }
        if (isPositionInsideAnyZone(pos, zoneBoxes)) {
          continue;
        }
        const { px, py } = worldToCanvas(pos[0], pos[2], spatial, simRect, rect);
        const size = 12;
        ctx.save();
        ctx.fillStyle = 'rgba(120, 120, 120, 0.5)';
        ctx.strokeStyle = 'rgba(170, 170, 170, 0.8)';
        ctx.lineWidth = 1;
        ctx.fillRect(px - size / 2, py - size / 2, size, size);
        ctx.strokeRect(px - size / 2, py - size / 2, size, size);
        ctx.restore();
      }
    }
  }
  requestAnimationFrame(frame);
}

/**
 * @param {string} httpUrl
 */
function toWsUrl(httpUrl) {
  return httpUrl.replace(/^http/, 'ws');
}

/**
 * Maps world XZ to overlay canvas pixel coords using the simulator canvas's actual screen rect.
 * @param {number} wx
 * @param {number} wz
 * @param {HubSpatialState} spatial
 * @param {DOMRect} simRect  getBoundingClientRect() of the simulator's #sim-canvas
 * @param {DOMRect} overlayRect  getBoundingClientRect() of the overlay canvas
 * @returns {{ px: number, py: number }}
 */
function worldToCanvas(wx, wz, spatial, simRect, overlayRect) {
  const nx = (wx - spatial.x1) / (spatial.x2 - spatial.x1);
  const ny = (wz - spatial.z1) / (spatial.z2 - spatial.z1);
  return {
    px: (simRect.left - overlayRect.left) + nx * simRect.width,
    py: (simRect.top - overlayRect.top) + ny * simRect.height,
  };
}

/**
 * Maps a client pointer position to world XZ using the simulator canvas's screen rect.
 * @param {number} clientX
 * @param {number} clientY
 * @param {HubSpatialState} spatial
 * @param {DOMRect} simRect
 * @returns {{ wx: number, wz: number } | null}
 */
function clientToWorldViaSimCanvas(clientX, clientY, spatial, simRect) {
  const nx = (clientX - simRect.left) / simRect.width;
  const ny = (clientY - simRect.top) / simRect.height;
  return {
    wx: spatial.x1 + nx * (spatial.x2 - spatial.x1),
    wz: spatial.z1 + ny * (spatial.z2 - spatial.z1),
  };
}

/**
 * @param {unknown} intent
 * @returns {string}
 */
function intentGuid(intent) {
  return (intent !== null && typeof intent === 'object' && !Array.isArray(intent))
    ? String(/** @type {Record<string, unknown>} */ (intent).guid ?? '')
    : '';
}

/**
 * @param {unknown} intent
 * @returns {number}
 */
function intentLayer(intent) {
  const params = (intent !== null && typeof intent === 'object' && !Array.isArray(intent))
    ? /** @type {Record<string, unknown>} */ (intent).params
    : undefined;
  return (params !== null && typeof params === 'object' && !Array.isArray(params))
    ? Number(/** @type {Record<string, unknown>} */ (params).layer)
    : NaN;
}

/**
 * @param {unknown[]} intents
 * @param {WebSocket} ws
 * @param {number[]} location
 */
function fireIntentEvents(intents, ws, location) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ message: { type: 'intents', location, payload: intents } }));
}

/** @type {Map<string, unknown>} intentState keyed by intent guid */
const intentState = new Map();

/** @type {Map<string, unknown>} outboundMap keyed by intent guid */
const outboundMap = new Map();
let lastSentAt = 0;
let sendPending = false;
let minIntervalMs = 40;
/** @type {WebSocket | null} */
let activeWs = null;
/** @type {number[] | null} */
let activeLocation = null;

/**
 * @param {unknown} intent
 */
function queueIntentUpdate(intent) {
  const guid = intentGuid(intent);
  if (!guid) return;
  outboundMap.set(guid, intent);
  scheduleFlush();
}

function scheduleFlush() {
  if (sendPending) return;
  const elapsed = Date.now() - lastSentAt;
  if (elapsed >= minIntervalMs) {
    flushOutbound();
  } else {
    sendPending = true;
    setTimeout(() => {
      sendPending = false;
      flushOutbound();
    }, minIntervalMs - elapsed);
  }
}

function flushOutbound() {
  if (outboundMap.size === 0 || !activeWs || !activeLocation) return;
  const intents = [...outboundMap.values()];
  outboundMap.clear();
  lastSentAt = Date.now();
  fireIntentEvents(intents, activeWs, activeLocation);
}

/**
 * @param {unknown[]} incomingIntents
 * @param {{ sendToHub?: boolean, pruneMissing?: boolean }} [opts]
 */
function reconcileIntents(incomingIntents, { sendToHub = true, pruneMissing = true } = {}) {
  const incoming = new Map();
  for (const intent of incomingIntents) {
    const guid = intentGuid(intent);
    if (!guid) continue;
    incoming.set(guid, intent);
  }

  for (const [guid, intent] of incoming) {
    const existing = intentState.get(guid);
    if (!existing || JSON.stringify(existing) !== JSON.stringify(intent)) {
      intentState.set(guid, intent);
      if (sendToHub) {
        queueIntentUpdate(intent);
      }
    }
  }

  if (pruneMissing) {
    for (const guid of intentState.keys()) {
      if (!incoming.has(guid)) {
        intentState.delete(guid);
      }
    }
  }
}

async function main() {
  let res;
  try {
    res = await fetch('./config.json', { cache: 'no-store' });
  } catch (e) {
    showConfigError(`Could not load config.json (${/** @type {Error} */ (e).message}).`);
    return;
  }
  if (!res.ok) {
    showConfigError(`config.json HTTP ${res.status}`);
    return;
  }
  /** @type {unknown} */
  let cfg;
  try {
    cfg = await res.json();
  } catch {
    showConfigError('config.json is not valid JSON.');
    return;
  }
  if (!validateControllerConfig(cfg)) {
    showConfigError(
      'config.json failed validation: see README for required keys (including CONTROLLER_GUID, SIMULATOR_RENDERER_GUID, GEO_LOCATION).'
    );
    return;
  }

  const L = cfg.LAYOUT;
  applyLayoutCssVars(L);

  const iframe = /** @type {HTMLIFrameElement | null} */ (document.getElementById('sim-frame'));
  const stack = document.getElementById('sim-stack');
  const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('touch-overlay'));
  if (!iframe || !stack || !canvas) {
    showConfigError('Missing #sim-frame, #sim-stack, or #touch-overlay in DOM.');
    return;
  }

  const simUrl = new URL(cfg.SIMULATOR_IFRAME_URL, window.location.href).href;
  iframe.src = simUrl;

  /** @type {HubSpatialState | null} */
  let hubSpatial = null;
  /** @type {number[][]} */
  let hubZoneBoxes = [];

  const [geoLon, geoLat] = cfg.GEO_LOCATION.split(/\s+/).map(Number);
  const location = [geoLon, geoLat];

  /**
   * @param {string} guid
   * @param {number} wx
   * @param {number} wz
   */
  function onIntentDrag(guid, wx, wz) {
    const intent = intentState.get(guid);
    if (!intent) return;
    const i = /** @type {Record<string, unknown>} */ (intent);
    const pos = /** @type {number[]} */ (i.position);
    const updated = { ...i, position: [wx, pos[1] ?? 0, wz] };
    intentState.set(guid, updated);
    queueIntentUpdate(updated);
  }

  const wsUrl = toWsUrl(cfg.AMBITECTURE_HUB_URL);
  const ws = new WebSocket(wsUrl);
  activeWs = ws;
  activeLocation = location;

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({
      message: {
        type: 'register',
        location,
        payload: { role: 'controller', guid: cfg.CONTROLLER_GUID, scope: [] },
      },
    }));
    setSpatialReadout('registered as controller — waiting for config…');
  });

  ws.addEventListener('message', (evt) => {
    let envelope;
    try {
      envelope = JSON.parse(/** @type {string} */ (evt.data));
    } catch {
      return;
    }
    const message = envelope?.message;
    if (!message?.type) return;

    if (message.type === 'config') {
      const next = spatialStateFromControllerConfig(message.payload, cfg.SIMULATOR_RENDERER_GUID);
      hubZoneBoxes = zoneBoundingBoxesFromControllerConfig(message.payload, cfg.SIMULATOR_RENDERER_GUID);
      if (next) {
        hubSpatial = next;
        setSpatialReadout('hub config received — drag on the touch overlay');
      } else {
        setSpatialReadout('config received but no zone for SIMULATOR_RENDERER_GUID');
      }
      const rateLimit = message.payload?.rateLimitEventsPerSecond;
      if (typeof rateLimit === 'number' && rateLimit > 0) {
        minIntervalMs = 1000 / rateLimit;
      }
      const intents = Array.isArray(message.payload?.intents) ? message.payload.intents : [];
      reconcileIntents(intents);
      return;
    }

    if (message.type === 'refresh') {
      const allIntents = [...intentState.values()];
      if (allIntents.length > 0) {
        fireIntentEvents(allIntents, ws, location);
      }
      return;
    }

    if (message.type === 'intents') {
      const incoming = Array.isArray(message.payload) ? message.payload : [];
      reconcileIntents(incoming, { sendToHub: false, pruneMissing: false });
      return;
    }
  });

  ws.addEventListener('error', () => {
    setSpatialReadout('WebSocket error');
  });

  setupOverlayCanvas(L, canvas, stack, () => hubSpatial, () => hubZoneBoxes, () => intentState, onIntentDrag, iframe);
}

main();
