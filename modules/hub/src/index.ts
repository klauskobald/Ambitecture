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
import { EventQueue } from './EventQueue';
import { ProjectManager } from './ProjectManager';
import { Logger } from './Logger';

const serverConfig = new Config('server');
const port = serverConfig.get<number>('LISTEN_PORT');
const host = serverConfig.getOrDefault<string>('LISTEN_HOST', '127.0.0.1');

const projectManager = new ProjectManager(
  serverConfig.get<string>('projectsPath'),
  serverConfig.get<string>('fixturesPath')
);

const registry = new ConnectionRegistry();
const router = new MessageRouter(registry);

const pushConfigsToModules = () => {
  for (const ws of registry.getByRole('renderer')) {
    const info = registry.get(ws);
    if (info && ws.readyState === ws.OPEN) {
      const config = projectManager.buildRendererConfig(info.guid);
      ws.send(JSON.stringify({ message: { type: 'config', payload: config } }));
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
router.register('register', new RegisterHandler(registry, projectManager, rateLimitEventsPerSecond));
router.register('events', new EventsHandler(registry));
router.register('intents', new IntentsHandler(registry, projectManager, eventQueue));
router.register('fixtures', new FixturesHandler(registry, projectManager, pushConfigsToModules));
const sceneHandler = new SceneHandler(registry, projectManager, eventQueue, pushConfigsToModules);
router.register('scene:activate', sceneHandler);
router.register('scene:update', sceneHandler);

projectManager.useProject(serverConfig.get<string>('defaultProject'), () => {
  pushConfigsToModules();
});

const server = new Server(registry, router);
server.listen(port, host);

Logger.info(`Hub listening on ${host}:${port}`);
