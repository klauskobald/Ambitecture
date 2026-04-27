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
 * @returns {cfg is { SIMULATOR_IFRAME_URL: string, LAYOUT: LayoutConfig }}
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
    console.error('deliver web-test:', message);
    return;
  }
  el.textContent = message;
  el.hidden = false;
  console.error('deliver web-test:', message);
}

/**
 * @param {LayoutConfig} L
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} stack
 */
function setupOverlayCanvas(L, canvas, stack) {
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

  function pushSample(x, y) {
    samples.push({ x, y, t: performance.now() });
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
    pushSample(x, y);
  }

  function onPointerMove(ev) {
    if (!activePointers.has(ev.pointerId)) {
      return;
    }
    const { x, y } = canvasPointFromEvent(ev);
    pushSample(x, y);
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
      'config.json failed validation: need SIMULATOR_IFRAME_URL, AMBITECTURE_HUB_URL, and all LAYOUT keys from README.'
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

  setupOverlayCanvas(L, canvas, stack);
}

main();
