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
import { statsTool } from './statsTool';
import { recordRendererEventDeliveries } from './hubWebSocketStats';
import { RuntimeUpdateDispatcher } from './RuntimeUpdateDispatcher';
import { RuntimeIntentStore } from './RuntimeIntentStore';
import { ProjectManager } from './ProjectManager';
import { ProjectGraphStore } from './ProjectGraphStore';
import { ActionInputManager } from './ActionInputManager';
import { Logger } from './Logger';
import { GraphMutationResult } from './GraphProtocol';
import { HubStatusDispatcher } from './hubStatusTypes';
import { AnimationManager } from './animation/AnimationManager';
import { FixtureStateManager } from './resolve/FixtureStateManager';
import { PhysicsEngine, type PhysicsConfig } from './physics/PhysicsEngine';
import { PhysicsIntentAdapter, type DragConfig } from './physics/PhysicsIntentAdapter';
import { BindingManager } from './BindingManager';
import { BindingHandler } from './handlers/BindingHandler';
import { AnimationEditHandler } from './handlers/AnimationEditHandler';
import { DiscoveryService } from './DiscoveryService';
import { DiscoveryHandler } from './handlers/DiscoveryHandler';
import { resolveRuntimeReferences } from './ConfigResolver';
import { registerZonesRangeResolver } from './resolvers/ZonesRangeResolver';
import { registerMaxFollowTimeResolver } from './resolvers/MaxFollowTimeResolver';
import { PulseManager } from './pulse/PulseManager';
import { PulseBucketAssignManager } from './pulse/PulseBucketAssignManager';
import { PulseAssignHandler } from './handlers/PulseAssignHandler';
import { PulseSetupManager } from './pulse/PulseSetupManager';
import { PulseControlHandler } from './handlers/PulseControlHandler';
import { PulseTapHandler } from './handlers/PulseTapHandler';
import { PulseSyncHandler } from './handlers/PulseSyncHandler';
import { parsePulseTapTempoConfig } from './pulse/PulseTapTempoConfig';
import { PulseSync } from './pulse/PulseSync';
import { SnapshotManager } from './snapshot/SnapshotManager';
import { SnapshotCaptureHandler } from './handlers/SnapshotCaptureHandler';
import { readActiveProjectSpec, writeActiveProjectSpec } from './ActiveProjectStore';

function normalizeProjectSpecifier(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.startsWith('-')) {
    return undefined;
  }
  return trimmed;
}

function projectSpecifierFromArgv(): string | undefined {
  return normalizeProjectSpecifier(process.argv[2]);
}

function projectSpecifierFromEnv(): string | undefined {
  return normalizeProjectSpecifier(process.env.HUB_PROJECT);
}

function explicitProjectSpecifier(): string | undefined {
  return projectSpecifierFromArgv() ?? projectSpecifierFromEnv();
}

function resolveInitialProjectSpec(): string {
  const explicit = explicitProjectSpecifier();
  if (explicit !== undefined) {
    return explicit;
  }
  const persisted = readActiveProjectSpec();
  if (persisted !== null) {
    return persisted;
  }
  throw new Error(
    '[project] no project specified (CLI/HUB_PROJECT) and no activeProject persisted under var/hub — run with a project name or ./start.sh <project> first',
  );
}

const serverConfig = new Config('server');
const systemConfig = new Config('system', true);
const port = serverConfig.get<number>('LISTEN_PORT');
const host = serverConfig.getOrDefault<string>('LISTEN_HOST', '127.0.0.1');

const projectManager = new ProjectManager(
  serverConfig.get<string>('projectsPath'),
  serverConfig.get<string>('fixturesPath'),
);
registerZonesRangeResolver(projectManager);
registerMaxFollowTimeResolver(projectManager);
const actionInputManager = new ActionInputManager(
  projectManager,
  () => resolveRuntimeReferences(systemConfig.getOrDefault<unknown>('systemCapabilities', {})),
);

const registry = new ConnectionRegistry();
const discoveryService = new DiscoveryService();
const router = new MessageRouter(registry);
const rateLimitEventsPerSecond = serverConfig.get<number>('rateLimitEventsPerSecond');
statsTool.setup({});
const eventQueue = new EventQueue(registry);
const runtimeIntentStore = new RuntimeIntentStore(projectManager);
projectManager.configureEffectiveIntentResolver(guid => runtimeIntentStore.getEffectiveIntent(guid));
const runtimeUpdateDispatcher = new RuntimeUpdateDispatcher(registry, eventQueue, runtimeIntentStore);
const hubStatusDispatcher = new HubStatusDispatcher(registry);
const bindingManager = new BindingManager();
const animationManager = new AnimationManager(
  projectManager,
  runtimeIntentStore,
  hubStatusDispatcher,
  runtimeUpdateDispatcher,
  bindingManager,
);
const fixtureStateManager = new FixtureStateManager(projectManager, runtimeIntentStore, registry);
const physicsConfig = systemConfig.getOrDefault<Partial<PhysicsConfig> & {
  dragStiffness?: number; dragMaxForce?: number;
}>('physics', {});
const physicsEngine = new PhysicsEngine({
  fps: physicsConfig.fps ?? 20,
  sleepVelocity: physicsConfig.sleepVelocity ?? 0.1,
  iterations: physicsConfig.iterations ?? 8,
  watchIntervalMs: physicsConfig.watchIntervalMs ?? 500,
});
const physicsIntentAdapter = new PhysicsIntentAdapter(
  projectManager,
  runtimeIntentStore,
  runtimeUpdateDispatcher,
  physicsEngine,
  {
    stiffness: physicsConfig.dragStiffness ?? 80,
    maxForce: physicsConfig.dragMaxForce ?? 120,
  },
);
const pulseManager = new PulseManager(projectManager);
pulseManager.setHubStatusDispatcher(hubStatusDispatcher);
const pulseSetupManager = new PulseSetupManager(projectManager);
const pulseBucketAssignManager = new PulseBucketAssignManager(
  projectManager,
  () => resolveRuntimeReferences(systemConfig.getOrDefault<unknown>('systemCapabilities', {})),
);
const graphStore = new ProjectGraphStore(
  projectManager,
  actionInputManager,
  runtimeUpdateDispatcher,
  runtimeIntentStore,
  animationManager,
  () => resolveRuntimeReferences(systemConfig.getOrDefault<unknown>('systemCapabilities', {})),
  pulseSetupManager,
);
graphStore.setConnectivityListener(() => physicsIntentAdapter.rebuild());
const snapshotManager = new SnapshotManager(
  projectManager,
  graphStore,
  pulseManager,
  pulseSetupManager,
  animationManager,
);

const buildActiveSceneEventsMsg = (): { msg: string | null; eventCount: number } => {
  const events = graphStore.getActiveSceneEvents();
  if (events.length === 0) {
    return { msg: null, eventCount: 0 };
  }
  return {
    msg: JSON.stringify({ message: { type: 'events', payload: events } }),
    eventCount: events.length,
  };
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
  const activeSceneGuid = projectManager.getActiveSceneGuid();
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
    message: { type: 'projectPatch', payload: { key: 'activeSceneGuid', data: activeSceneGuid } },
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
  const sceneEvents = buildActiveSceneEventsMsg();
  let sceneEventRecipients = 0;
  for (const ws of registry.getByRole('renderer')) {
    const info = registry.get(ws);
    if (info && ws.readyState === ws.OPEN) {
      const config = graphStore.buildRendererConfig(info.guid);
      ws.send(JSON.stringify({ message: { type: 'config', payload: config } }));
      if (sceneEvents.msg && registry.wantsRendererEvents(ws)) {
        ws.send(sceneEvents.msg);
        sceneEventRecipients += 1;
      }
    }
  }
  recordRendererEventDeliveries(sceneEvents.eventCount, sceneEventRecipients);
  pushControllerProjectPatches(includeControllerIntentPatch);
  fixtureStateManager.refresh();
};

const publishGraphMutation = (source: import('ws').WebSocket | undefined, result: GraphMutationResult, location?: [number, number]): void => {
  if (result.controllerDeltas.length > 0) {
    for (const ws of registry.getByRole('controller')) {
      if ((source !== undefined && ws === source) || ws.readyState !== ws.OPEN) continue;
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
    const entries = result.rendererEvents.map(event => {
      const scheduled = (event as Record<string, unknown>)['scheduled'];
      return {
        event,
        scheduledAt: typeof scheduled === 'number' ? scheduled : now,
      };
    })

    eventQueue.schedule(
      entries,
      location,
    );
  }
  if (result.rendererConfigChangedFor.length > 0) {
    // Fixture geometry changed: the resolver caches each fixture's world position (e.g. the target
    // aim point is worldPos + easedDir), so rebuild it here — otherwise renderers get a fresh config
    // but the hub keeps resolving against the old position until the next restart.
    fixtureStateManager.refresh();
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
      && typeof /** @type {Record<string, unknown>} */ (p).activeSceneGuid === 'string'
    );
  });

  if (sceneActivateResync) {
    physicsIntentAdapter.rebuild();
    const scenesWire = projectManager.getScenesWirePayload();
    const activeDelta = result.controllerDeltas.find(d => {
      if (d.entityType !== 'project' || d.guid !== 'active' || d.op !== 'patch') return false;
      const p = d.patch;
      return (
        p !== undefined
        && typeof p === 'object'
        && !Array.isArray(p)
        && typeof /** @type {Record<string, unknown>} */ (p).activeSceneGuid === 'string'
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

router.register('register', new RegisterHandler(
  registry,
  graphStore,
  projectManager,
  rateLimitEventsPerSecond,
  systemConfig,
  discoveryService,
  pulseManager,
  hubStatusDispatcher,
));
router.register('discovery:subscribe', new DiscoveryHandler(discoveryService));
router.register('graph:command', new GraphCommandHandler(registry, graphStore, publishGraphMutation));
router.register('runtime:command', new RuntimeCommandHandler(registry, runtimeUpdateDispatcher, rateLimitEventsPerSecond));
const actionHandler = new ActionHandler(
  registry,
  graphStore,
  actionInputManager,
  publishGraphMutation,
  runtimeUpdateDispatcher,
  animationManager,
  snapshotManager,
);
router.register('action:input', actionHandler);
router.register('action:trigger', actionHandler);
router.register('snapshot:capture', new SnapshotCaptureHandler(
  registry,
  snapshotManager,
  publishGraphMutation,
));
router.register('pulse:assign', new PulseAssignHandler(
  registry,
  graphStore,
  pulseBucketAssignManager,
  projectManager,
  pulseManager,
  publishGraphMutation,
));
router.register('pulse:control', new PulseControlHandler(
  registry,
  pulseSetupManager,
  pulseManager,
  projectManager,
));
const pulseTapTempoConfig = parsePulseTapTempoConfig(
  systemConfig.getOrDefault<unknown>('pulse', null),
);
router.register('pulse:tap', new PulseTapHandler(
  registry,
  pulseTapTempoConfig,
  pulseManager,
  pulseSetupManager,
  projectManager,
));
const pulseSync = new PulseSync(
  pulseTapTempoConfig,
  pulseManager,
  projectManager,
  () => {
    const data = projectManager.getPulsesWirePayload();
    const patch = JSON.stringify({
      message: { type: 'projectPatch', payload: { key: 'pulses', data } },
    });
    for (const controllerWs of registry.getByRole('controller')) {
      if (controllerWs.readyState !== WebSocket.OPEN) continue;
      controllerWs.send(patch);
    }
  },
);
router.register('pulse:sync', new PulseSyncHandler(registry, pulseSync, hubStatusDispatcher));
pulseManager.setActionTriggerCallback(actionGuid => {
  actionHandler.triggerAction(actionGuid, undefined, { value: 'on' });
});
router.register('events', new EventsHandler(registry));
router.register('intents', new IntentsHandler(registry, projectManager, eventQueue, runtimeUpdateDispatcher));
router.register(
  'fixtures',
  new FixturesHandler(registry, projectManager, () => pushConfigsToModules(false)),
);
router.register('saveProject', new SaveProjectHandler(projectManager));
const bindingHandler = new BindingHandler(registry, bindingManager);
router.register('binding:subscribe', bindingHandler);
router.register('binding:set', bindingHandler);
router.register('animation:edit', new AnimationEditHandler(registry, animationManager));

const initialProjectSpec = resolveInitialProjectSpec();
const explicitInitialProject = explicitProjectSpecifier();
try {
  graphStore.useProject(initialProjectSpec, () => {
    pulseManager.initializeFromProject();
    pushConfigsToModules();
    fixtureStateManager.start();
    physicsIntentAdapter.start();
  });
} catch (err) {
  Logger.error(`[project] failed to load "${initialProjectSpec}"`, err);
  throw err;
}
if (explicitInitialProject !== undefined) {
  writeActiveProjectSpec(explicitInitialProject);
}

const server = new Server(registry, router);
server.addDisconnectHook(ws => {
  discoveryService.onSocketClosed(ws);
  bindingManager.onSocketClosed(ws);
});
server.listen(port, host);

Logger.info(`Hub listening on ${host}:${port}`);
