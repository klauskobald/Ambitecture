import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { ProjectManager } from '../ProjectManager';

interface RegisterPayload {
  role: 'renderer' | 'controller';
  guid: string;
  location?: [number, number];
  boundingBox?: unknown;
  scope?: unknown;
}

function isRegisterPayload(payload: unknown): payload is RegisterPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const p = payload as Record<string, unknown>;
  return (p['role'] === 'renderer' || p['role'] === 'controller') && typeof p['guid'] === 'string';
}

export class RegisterHandler implements MessageHandler {
  private registry: ConnectionRegistry;
  private projectManager: ProjectManager;
  private rateLimitEventsPerSecond: number;

  constructor(registry: ConnectionRegistry, projectManager: ProjectManager, rateLimitEventsPerSecond: number) {
    this.registry = registry;
    this.projectManager = projectManager;
    this.rateLimitEventsPerSecond = rateLimitEventsPerSecond;
  }

  handle(ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    if (!isRegisterPayload(message.payload)) {
      Logger.warn('[register] Invalid register payload');
      return;
    }

    const { role, guid, location, boundingBox, scope } = message.payload;

    const meta: Record<string, unknown> = {};
    if (boundingBox !== undefined) {
      meta['boundingBox'] = boundingBox;
    }
    if (scope !== undefined) {
      meta['scope'] = scope;
    }

    const update: Parameters<ConnectionRegistry['update']>[1] = { role, guid, meta };
    if (location !== undefined) {
      update.location = location;
    }

    this.registry.update(ws, update);
    Logger.info(`[register] ${role} ${guid}`);

    if (ws.readyState !== ws.OPEN) {
      return;
    }

    if (role === 'renderer') {
      const config = this.projectManager.buildRendererConfig(guid);
      ws.send(JSON.stringify({ message: { type: 'config', payload: config } }));
      Logger.info(`[register] pushed config to renderer ${guid}`);

      const controllers = this.registry.getByRole('controller');
      const openControllers = controllers.filter(c => c.readyState === WebSocket.OPEN);
      for (const controllerWs of openControllers) {
        controllerWs.send(JSON.stringify({ message: { type: 'refresh', payload: {} } }));
      }
      if (openControllers.length > 0) {
        Logger.info(`[register] sent refresh to ${openControllers.length} controller(s)`);
      }
    } else if (role === 'controller') {
      const config = {
        ...(this.projectManager.buildControllerConfig(guid) as object),
        rateLimitEventsPerSecond: this.rateLimitEventsPerSecond,
      };
      ws.send(JSON.stringify({ message: { type: 'config', payload: config } }));
      Logger.info(`[register] pushed config to controller ${guid}`);
    }
  }
}
