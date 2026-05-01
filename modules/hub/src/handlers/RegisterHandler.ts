import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { Config } from '../Config';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { ProjectManager } from '../ProjectManager';
import { normalizeIntentColor, intentToEvent } from './intentHelpers';

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
  private systemConfig: Config;

  constructor(registry: ConnectionRegistry, projectManager: ProjectManager, rateLimitEventsPerSecond: number, systemConfig: Config) {
    this.registry = registry;
    this.projectManager = projectManager;
    this.rateLimitEventsPerSecond = rateLimitEventsPerSecond;
    this.systemConfig = systemConfig;
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

      const activeIntents = this.projectManager.getActiveSceneIntents();
      if (activeIntents.length > 0) {
        const now = Date.now();
        const events = activeIntents.map(normalizeIntentColor).map(i => intentToEvent(i, now));
        ws.send(JSON.stringify({ message: { type: 'events', payload: events } }));
        Logger.info(`[register] pushed ${events.length} active scene event(s) to renderer ${guid}`);
      }
    } else if (role === 'controller') {
      const config = {
        ...this.projectManager.buildControllerConfig(guid),
        rateLimitEventsPerSecond: this.rateLimitEventsPerSecond,
      };
      ws.send(JSON.stringify({ message: { type: 'config', payload: config } }));
      Logger.info(`[register] pushed config to controller ${guid}`);

      const capabilities = this.systemConfig.getOrDefault<unknown>('systemCapabilities', null);
      if (capabilities !== null) {
        ws.send(JSON.stringify({ message: { type: 'systemCapabilities', payload: capabilities } }));
        Logger.info(`[register] pushed systemCapabilities to controller ${guid}`);
      }
    }
  }
}
