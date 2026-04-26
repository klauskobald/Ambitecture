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

const projectManager = new ProjectManager(serverConfig);

const registry = new ConnectionRegistry();
const router = new MessageRouter(registry);

router.register('register', new RegisterHandler(registry, projectManager));
router.register('events', new EventsHandler(registry));

const server = new Server(registry, router);
server.listen(port, host);

Logger.info(`Hub listening on ${host}:${port}`);
