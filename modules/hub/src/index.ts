import 'dotenv/config';
import { Config } from './Config';
import { Server } from './Server';
import { ConnectionRegistry } from './ConnectionRegistry';
import { MessageRouter } from './MessageRouter';
import { RegisterHandler } from './handlers/RegisterHandler';
import { EventsHandler } from './handlers/EventsHandler';
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

const rateLimitEventsPerSecond = serverConfig.get<number>('rateLimitEventsPerSecond');
router.register('register', new RegisterHandler(registry, projectManager, rateLimitEventsPerSecond));
router.register('events', new EventsHandler(registry));

projectManager.useProject(serverConfig.get<string>('defaultProject'), () => {
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
});

const server = new Server(registry, router);
server.listen(port, host);

Logger.info(`Hub listening on ${host}:${port}`);
