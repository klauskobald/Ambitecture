import 'dotenv/config';
import { Config } from './Config';
import { Server } from './Server';
import { ConnectionRegistry } from './ConnectionRegistry';
import { MessageRouter } from './MessageRouter';
import { RegisterHandler } from './handlers/RegisterHandler';
import { EventsHandler } from './handlers/EventsHandler';
import { IntentsHandler } from './handlers/IntentsHandler';
import { FixturesHandler } from './handlers/FixturesHandler';
import { SaveProjectHandler } from './handlers/SaveProjectHandler';
import { GraphCommandHandler } from './handlers/GraphCommandHandler';
import { RuntimeCommandHandler } from './handlers/RuntimeCommandHandler';
import { ActionHandler } from './handlers/ActionHandler';
import { EventQueue } from './EventQueue';
import { RuntimeUpdateDispatcher } from './RuntimeUpdateDispatcher';
import { RuntimeIntentStore } from './RuntimeIntentStore';
import { ProjectManager } from './ProjectManager';
import { ProjectGraphStore } from './ProjectGraphStore';
import { ActionInputManager } from './ActionInputManager';
import { Logger } from './Logger';
import { GraphMutationResult } from './GraphProtocol';
import { HubStatusDispatcher } from './hubStatusTypes';
import { AnimationManager } from './animation/AnimationManager';

const serverConfig = new Config('server');
const systemConfig = new Config('system', true);
const port = serverConfig.get<number>('LISTEN_PORT');
const host = serverConfig.getOrDefault<string>('LISTEN_HOST', '127.0.0.1');

const projectManager = new ProjectManager(
  serverConfig.get<string>('projectsPath'),
  serverConfig.get<string>('fixturesPath'),
);
const actionInputManager = new ActionInputManager(
  projectManager,
  () => systemConfig.getOrDefault<unknown>('systemCapabilities', {}),
);

const registry = new ConnectionRegistry();
const router = new MessageRouter(registry);
const rateLimitEventsPerSecond = serverConfig.get<number>('rateLimitEventsPerSecond');
const eventQueue = new EventQueue(registry);
const runtimeIntentStore = new RuntimeIntentStore(projectManager);
projectManager.configureEffectiveIntentResolver(guid => runtimeIntentStore.getEffectiveIntent(guid));
const runtimeUpdateDispatcher = new RuntimeUpdateDispatcher(registry, eventQueue, runtimeIntentStore);
const hubStatusDispatcher = new HubStatusDispatcher(registry);
const animationManager = new AnimationManager(
  projectManager,
  runtimeIntentStore,
  eventQueue,
  hubStatusDispatcher,
);
const graphStore = new ProjectGraphStore(
  projectManager,
  actionInputManager,
  runtimeUpdateDispatcher,
  runtimeIntentStore,
  animationManager,
);

const buildActiveSceneEventsMsg = (): string | null => {
  const events = graphStore.getActiveSceneEvents();
  if (events.length === 0) return null;
  return JSON.stringify({ message: { type: 'events', payload: events } });
};

/**
 * Controllers receive incremental `projectPatch` messages. For fixture-only triggers we omit the
 * intents patch so client zone/fixture layout edits are not overwritten by a full intent list.
 * Intent payloads are hub-effective (YAML + active-scene overlay + runtime perform merge).
 */
const pushControllerProjectPatches = (includeIntentsPatch: boolean): void => {
  const zones = projectManager.getSerializedRuntimeZones();
  const scenes = projectManager.getScenesWirePayload();
  const actions = projectManager.getActionsWirePayload();
  const zoneToRenderer = projectManager.getZoneToRendererPayload();
  const activeSceneName = projectManager.getActiveSceneName();
  const projectName = projectManager.getWireProjectName();

  const zonesMsg = JSON.stringify({
    message: { type: 'projectPatch', payload: { key: 'zones', data: zones } },
  });
  const scenesMsg = JSON.stringify({
    message: { type: 'projectPatch', payload: { key: 'scenes', data: scenes } },
  });
  const actionsMsg = JSON.stringify({
    message: { type: 'projectPatch', payload: { key: 'actions', data: actions } },
  });
  const ztrMsg = JSON.stringify({
    message: { type: 'projectPatch', payload: { key: 'zoneToRenderer', data: zoneToRenderer } },
  });
  const activeMsg = JSON.stringify({
    message: { type: 'projectPatch', payload: { key: 'activeSceneName', data: activeSceneName } },
  });
  const nameMsg = JSON.stringify({
    message: { type: 'projectPatch', payload: { key: 'projectName', data: projectName } },
  });

  let controllerCount = 0;
  for (const ws of registry.getByRole('controller')) {
    if (ws.readyState !== ws.OPEN) continue;
    const info = registry.get(ws);
    if (!info) continue;
    controllerCount += 1;
    ws.send(zonesMsg);
    ws.send(scenesMsg);
    ws.send(actionsMsg);
    const inputs = projectManager.getInputsWirePayload(info.guid);
    ws.send(JSON.stringify({
      message: { type: 'projectPatch', payload: { key: 'inputs', data: inputs } },
    }));
    ws.send(ztrMsg);
    ws.send(activeMsg);
    ws.send(nameMsg);
    if (includeIntentsPatch) {
      const intents = projectManager.getControllerIntents(info.guid);
      ws.send(JSON.stringify({
        message: { type: 'projectPatch', payload: { key: 'intents', data: intents } },
      }));
    }
  }
  if (controllerCount > 0) {
    const scope = includeIntentsPatch ? 'zones, scenes, intents, …' : 'zones, scenes, … (no intents)';
    Logger.info(`[hub] incremental projectPatch → ${controllerCount} controller(s) (${scope})`);
  }
};

/** Renderers get full `config` + scene events; controllers get `projectPatch` only (full `config` on register). */
const pushConfigsToModules = (includeControllerIntentPatch = true) => {
  const sceneEventsMsg = buildActiveSceneEventsMsg();
  for (const ws of registry.getByRole('renderer')) {
    const info = registry.get(ws);
    if (info && ws.readyState === ws.OPEN) {
      const config = graphStore.buildRendererConfig(info.guid);
      ws.send(JSON.stringify({ message: { type: 'config', payload: config } }));
      if (sceneEventsMsg) ws.send(sceneEventsMsg);
    }
  }
  pushControllerProjectPatches(includeControllerIntentPatch);
};

const publishGraphMutation = (source: import('ws').WebSocket, result: GraphMutationResult, location?: [number, number]): void => {
  if (result.controllerDeltas.length > 0) {
    for (const ws of registry.getByRole('controller')) {
      if (ws === source || ws.readyState !== ws.OPEN) continue;
      const info = registry.get(ws);
      const deltas = result.controllerDeltas.filter(delta =>
        delta.entityType !== 'controller' || info?.guid === delta.guid
      );
      if (deltas.length === 0) continue;
      const msg = JSON.stringify({
        message: {
          type: 'graph:delta',
          payload: deltas,
        },
      });
      ws.send(msg);
    }
  }
  if (result.rendererEvents.length > 0) {
    const now = Date.now();
    eventQueue.schedule(
      result.rendererEvents.map(event => {
        const scheduled = (event as Record<string, unknown>)['scheduled'];
        return {
          event,
          scheduledAt: typeof scheduled === 'number' ? scheduled : now,
        };
      }),
      location,
    );
  }
  if (result.rendererConfigChangedFor.length > 0) {
    const changed = new Set(result.rendererConfigChangedFor);
    for (const ws of registry.getByRole('renderer')) {
      const info = registry.get(ws);
      if (!info || ws.readyState !== ws.OPEN || !changed.has(info.guid)) continue;
      ws.send(JSON.stringify({ message: { type: 'config', payload: graphStore.buildRendererConfig(info.guid) } }));
    }
  }

  // Controllers follow hub intent snapshots; after scene change, push effective intents + scenes
  // so overlays match sim (graph:init parity).
  const sceneActivateResync = result.controllerDeltas.some(d => {
    if (d.entityType !== 'project' || d.guid !== 'active' || d.op !== 'patch') return false;
    const p = d.patch;
    return (
      p !== undefined
      && typeof p === 'object'
      && !Array.isArray(p)
      && typeof /** @type {Record<string, unknown>} */ (p).activeSceneName === 'string'
    );
  });

  if (sceneActivateResync) {
    const scenesWire = projectManager.getScenesWirePayload();
    const activeDelta = result.controllerDeltas.find(d => {
      if (d.entityType !== 'project' || d.guid !== 'active' || d.op !== 'patch') return false;
      const p = d.patch;
      return (
        p !== undefined
        && typeof p === 'object'
        && !Array.isArray(p)
        && typeof /** @type {Record<string, unknown>} */ (p).activeSceneName === 'string'
      );
    });
    const rawOverlay = activeDelta?.patch?.['runtimeOverlayGuidsInScene'];
    const runtimeOverlayGuidsInScene = Array.isArray(rawOverlay)
      ? rawOverlay.filter((g): g is string => typeof g === 'string')
      : [];
    const overlayMsg = JSON.stringify({
      message: {
        type: 'projectPatch',
        payload: { key: 'runtimeOverlayGuidsInScene', data: runtimeOverlayGuidsInScene },
      },
    });
    for (const ws of registry.getByRole('controller')) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const info = registry.get(ws);
      if (!info) continue;
      const intents = projectManager.getControllerIntents(info.guid);
      ws.send(
        JSON.stringify({
          message: {
            type: 'projectPatch',
            payload: { key: 'intents', data: intents },
          },
        })
      );
      ws.send(
        JSON.stringify({
          message: {
            type: 'projectPatch',
            payload: { key: 'scenes', data: scenesWire },
          },
        })
      );
      ws.send(overlayMsg);
    }

  }
};

router.register('register', new RegisterHandler(registry, graphStore, rateLimitEventsPerSecond, systemConfig));
router.register('graph:command', new GraphCommandHandler(registry, graphStore, publishGraphMutation));
router.register('runtime:command', new RuntimeCommandHandler(registry, runtimeUpdateDispatcher, rateLimitEventsPerSecond));
const actionHandler = new ActionHandler(
  registry,
  graphStore,
  actionInputManager,
  publishGraphMutation,
  runtimeUpdateDispatcher,
  animationManager,
);
router.register('action:input', actionHandler);
router.register('action:trigger', actionHandler);
router.register('events', new EventsHandler(registry));
router.register('intents', new IntentsHandler(registry, projectManager, eventQueue, runtimeUpdateDispatcher));
router.register(
  'fixtures',
  new FixturesHandler(registry, projectManager, () => pushConfigsToModules(false)),
);
router.register('saveProject', new SaveProjectHandler(projectManager));

graphStore.useProject(serverConfig.get<string>('defaultProject'), () => {
  pushConfigsToModules();
});

const server = new Server(registry, router);
server.listen(port, host);

Logger.info(`Hub listening on ${host}:${port}`);
