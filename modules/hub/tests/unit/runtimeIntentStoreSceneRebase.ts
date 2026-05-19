/**
 * Unit-style check: runtime patch on one path rebases on scene switch (other paths from new scene).
 * Run: `npm run test:runtime-scene-rebase` from modules/hub
 */
import * as path from 'path';
import { ProjectManager } from '../../src/ProjectManager';
import { RuntimeIntentStore } from '../../src/RuntimeIntentStore';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(msg);
  }
}

function main(): void {
  const hubRoot = path.resolve(__dirname, '../..');
  const yamlPath = path.join(__dirname, 'fixtures', 'runtime-scene-rebase.yml');
  const fixturesPath = path.resolve(hubRoot, '../../var/fixtures');

  const pm = new ProjectManager(path.dirname(yamlPath), fixturesPath);
  pm.useProject(yamlPath, () => undefined);

  const store = new RuntimeIntentStore(pm);
  pm.configureEffectiveIntentResolver(guid => store.getEffectiveIntent(guid));

  const guid = 'light-rb-1';

  const sceneA = pm.getActiveSceneIntent(guid);
  assert(!!sceneA, 'scene A intent');
  const colorA = (sceneA!.params as Record<string, unknown>)['color'] as Record<string, unknown>;
  assert(colorA['h'] === 10, 'expected scene A overlay color.h');

  store.processRuntimeUpdates(
    [{
      entityType: 'intent',
      guid,
      source: 'test',
      patch: { position: [99, 0, 99] },
    }],
    Date.now(),
  );

  const effOnA = store.getEffectiveIntent(guid);
  assert(!!effOnA, 'effective on A');
  assert(
    effOnA!.position![0] === 99 && effOnA!.position![2] === 99,
    'runtime position applied',
  );
  const cA = (effOnA!.params as Record<string, unknown>)['color'] as Record<string, unknown>;
  assert(cA['h'] === 10, 'scene A color preserved with runtime position');

  pm.setActiveScene('sceneRbB', false);

  const effOnB = store.getEffectiveIntent(guid);
  assert(!!effOnB, 'effective on B');
  assert(
    effOnB!.position![0] === 99 && effOnB!.position![2] === 99,
    'runtime position survives scene switch',
  );
  const cB = (effOnB!.params as Record<string, unknown>)['color'] as Record<string, unknown>;
  assert(
    cB['h'] === 200,
    `scene B color from new scene baseline, got h=${String(cB['h'])}`,
  );

  store.clear();
  pm.configureEffectiveIntentResolver(undefined);
  console.log('runtimeIntentStoreSceneRebase: PASS');
}

main();
