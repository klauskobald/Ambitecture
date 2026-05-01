import 'dotenv/config';
import { Config } from './Config';
import { Server } from './Server';
import { ConnectionRegistry } from './ConnectionRegistry';
import { MessageRouter } from './MessageRouter';
import { RegisterHandler } from './handlers/RegisterHandler';
import { EventsHandler } from './handlers/EventsHandler';
import { IntentsHandler } from './handlers/IntentsHandler';
import { FixturesHandler } from './handlers/FixturesHandler';
import { SceneHandler } from './handlers/SceneHandler';
import { SaveProjectHandler } from './handlers/SaveProjectHandler';
import { EventQueue } from './EventQueue';
import { ProjectManager } from './ProjectManager';
import { Logger } from './Logger';
import { normalizeIntentColor, intentToEvent } from './handlers/intentHelpers';

const serverConfig = new Config('server');
const systemConfig = new Config('system', true);
const port = serverConfig.get<number>('LISTEN_PORT');
const host = serverConfig.getOrDefault<string>('LISTEN_HOST', '127.0.0.1');

const projectManager = new ProjectManager(
  serverConfig.get<string>('projectsPath'),
  serverConfig.get<string>('fixturesPath'),
);

const registry = new ConnectionRegistry();
const router = new MessageRouter(registry);

const buildActiveSceneEventsMsg = (): string | null => {
  const intents = projectManager.getActiveSceneIntents();
  if (intents.length === 0) return null;
  const now = Date.now();
  const events = intents.map(normalizeIntentColor).map(i => intentToEvent(i, now));
  return JSON.stringify({ message: { type: 'events', payload: events } });
};

const pushConfigsToModules = () => {
  const sceneEventsMsg = buildActiveSceneEventsMsg();
  for (const ws of registry.getByRole('renderer')) {
    const info = registry.get(ws);
    if (info && ws.readyState === ws.OPEN) {
      const config = projectManager.buildRendererConfig(info.guid);
      ws.send(JSON.stringify({ message: { type: 'config', payload: config } }));
      if (sceneEventsMsg) ws.send(sceneEventsMsg);
    }
  }
  for (const ws of registry.getByRole('controller')) {
    const info = registry.get(ws);
    if (info && ws.readyState === ws.OPEN) {
      const config = projectManager.buildControllerConfig(info.guid);
      ws.send(JSON.stringify({ message: { type: 'config', payload: config } }));
    }
  }
};

const rateLimitEventsPerSecond = serverConfig.get<number>('rateLimitEventsPerSecond');
const eventQueue = new EventQueue(registry);
router.register('register', new RegisterHandler(registry, projectManager, rateLimitEventsPerSecond, systemConfig));
router.register('events', new EventsHandler(registry));
router.register('intents', new IntentsHandler(registry, projectManager, eventQueue));
router.register('fixtures', new FixturesHandler(registry, projectManager, pushConfigsToModules));
const sceneHandler = new SceneHandler(registry, projectManager, eventQueue);
router.register('scene:activate', sceneHandler);
router.register('saveProject', new SaveProjectHandler(projectManager));

projectManager.useProject(serverConfig.get<string>('defaultProject'), () => {
  pushConfigsToModules();
});

const server = new Server(registry, router);
server.listen(port, host);

Logger.info(`Hub listening on ${host}:${port}`);
