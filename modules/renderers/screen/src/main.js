import { ConfigHandler } from './handlers/ConfigHandler.js';
import { EventsHandler } from './handlers/EventsHandler.js';
import { HubConnection } from './HubConnection.js';
import { LifecycleHud } from './LifecycleHud.js';
import { ScreenRenderer } from './ScreenRenderer.js';

async function boot() {
  const hudRoot = document.getElementById('lifecycle-hud');
  if (!(hudRoot instanceof HTMLElement)) {
    console.error('[screen] missing #lifecycle-hud');
    return;
  }
  const hud = new LifecycleHud(hudRoot);

  const canvas = document.getElementById('screen-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    hud.showEphemeral('Missing canvas', '', 'failed');
    return;
  }

  const screenRenderer = new ScreenRenderer(canvas);
  const configHandler = new ConfigHandler(screenRenderer);
  const eventsHandler = new EventsHandler(configHandler, screenRenderer);
  configHandler.setOnConfigApplied(() => eventsHandler.reapplyCurrentIntents(true));

  const hub = new HubConnection({}, hud, {
    onConfig: payload => configHandler.handle(payload),
    onEvents: payload => eventsHandler.handle(payload),
  });

  hub.onBoot();

  let config;
  try {
    const resp = await fetch('./config.json', { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    config = await resp.json();
  } catch (err) {
    hud.showEphemeral(
      'Config failed',
      err instanceof Error ? err.message : String(err),
      'failed'
    );
    return;
  }

  Object.assign(hub._config, config);
  hub.onConfigLoaded(config);
  screenRenderer.start();
  hub.connect();

  window.addEventListener('beforeunload', () => {
    hub.disconnect();
    screenRenderer.stop();
  });
}

boot();
