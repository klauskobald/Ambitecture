import { ConfigHandler } from './handlers/ConfigHandler.js';
import { FixtureStateHandler } from './handlers/FixtureStateHandler.js';
import { HubConnection } from './HubConnection.js';
import { LifecycleHud } from './LifecycleHud.js';
import { ScreenFixturePicker } from './ScreenFixturePicker.js';
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

  const selection = { guid: /** @type {string | null} */ (null) };
  const fixtureStateHandler = new FixtureStateHandler(
    configHandler,
    screenRenderer,
    () => selection.guid
  );

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

  const rendererGuid = String(config.GUID ?? '').trim() || 'screen-renderer';
  const picker = new ScreenFixturePicker({
    rendererGuid,
    canvas,
    configHandler,
    onSelect: guid => {
      selection.guid = guid;
      screenRenderer.setSelectedFixtureGuid(guid);
      fixtureStateHandler.reapplyCurrentIntents();
    }
  });

  configHandler.setOnConfigApplied(() => {
    picker.syncAfterConfig();
    fixtureStateHandler.reapplyCurrentIntents();
  });

  const hub = new HubConnection({}, hud, {
    onConfig: payload => configHandler.handle(payload),
    onFixtureState: payload => fixtureStateHandler.handle(payload),
  });

  hub.onBoot();

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
