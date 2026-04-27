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
 * Zone bounding box in meters (hub `config`); canvas maps 1:1 to XZ span on screen.
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
 * Map client coords to meters using the same on-screen rect as `#sim-canvas` and the zone bbox (linear XZ).
 * @param {number} clientX
 * @param {number} clientY
 * @param {HTMLIFrameElement} iframe
 * @param {HubSpatialState} s
 * @returns {{ wx: number; wy: number; wz: number } | null}
 */
function simCanvasClientToBboxMeters(clientX, clientY, iframe, s) {
  const doc = iframe.contentDocument;
  if (!doc) {
    return null;
  }
  const simCanvas = doc.getElementById('sim-canvas');
  if (!(simCanvas instanceof HTMLCanvasElement)) {
    return null;
  }
  const r = simCanvas.getBoundingClientRect();
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
  return { wx, wy, wz };
}

/**
 * @param {LayoutConfig} L
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} stack
 * @param {HTMLIFrameElement} iframe
 * @param {() => HubSpatialState | null} getSpatial
 */
function setupOverlayCanvas(L, canvas, stack, iframe, getSpatial) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    showConfigError('Canvas 2D context unavailable.');
    return;
  }

  /** @type {{ x: number; y: number; t: number }[]} */
  const samples = [];

  /** @type {Set<number>} */
  const activePointers = new Set();

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
    const m = simCanvasClientToBboxMeters(clientX, clientY, iframe, spatial);
    if (!m) {
      setSpatialReadout('outside simulator canvas');
      return;
    }
    const { wx, wy, wz } = m;
    setSpatialReadout(
      `meters (inside zone bbox)  x=${wx.toFixed(3)}  y=${wy.toFixed(3)}  z=${wz.toFixed(3)}`
    );
  }

  function onPointerDown(ev) {
    if (ev.button !== undefined && ev.button !== 0) {
      return;
    }
    activePointers.add(ev.pointerId);
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch {
      // ignore if capture unsupported
    }
    const { x, y } = canvasPointFromEvent(ev);
    pushSample(ev.clientX, ev.clientY, x, y);
  }

  function onPointerMove(ev) {
    if (!activePointers.has(ev.pointerId)) {
      return;
    }
    const { x, y } = canvasPointFromEvent(ev);
    pushSample(ev.clientX, ev.clientY, x, y);
  }

  function onPointerUp(ev) {
    activePointers.delete(ev.pointerId);
    try {
      canvas.releasePointerCapture(ev.pointerId);
    } catch {
      // ignore if not captured
    }
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
  }
  requestAnimationFrame(frame);
}

/**
 * @param {string} httpUrl
 */
function toWsUrl(httpUrl) {
  return httpUrl.replace(/^http/, 'ws');
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

  const wsUrl = toWsUrl(cfg.AMBITECTURE_HUB_URL);
  const ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    const [geoLon, geoLat] = cfg.GEO_LOCATION.split(/\s+/).map(Number);
    ws.send(
      JSON.stringify({
        message: {
          type: 'register',
          location: [geoLon, geoLat],
          payload: {
            role: 'controller',
            guid: cfg.CONTROLLER_GUID,
            scope: [],
          },
        },
      })
    );
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
    if (!message?.type || message.type !== 'config') {
      return;
    }
    const next = spatialStateFromControllerConfig(message.payload, cfg.SIMULATOR_RENDERER_GUID);
    if (next) {
      hubSpatial = next;
      setSpatialReadout('hub config received — drag over simulator');
    } else {
      setSpatialReadout('config received but no zone for SIMULATOR_RENDERER_GUID');
    }
  });

  ws.addEventListener('error', () => {
    setSpatialReadout('WebSocket error');
  });

  setupOverlayCanvas(L, canvas, stack, iframe, () => hubSpatial);
}

main();
