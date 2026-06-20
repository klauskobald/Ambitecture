import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { ProjectManager } from '../ProjectManager';
import { ProjectGraphStore } from '../ProjectGraphStore';
import { ProbeContext, getProbeQuery } from '../probe/ProbeQueryRegistry';

interface SystemProbeRequest {
  requestId: string;
  query: string;
  args?: unknown;
}

function isSystemProbeRequest(payload: unknown): payload is SystemProbeRequest {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;
  return typeof p['requestId'] === 'string' && typeof p['query'] === 'string';
}

/**
 * Multi-purpose read-only query endpoint. Dispatches `payload.query` through the
 * probe query registry and replies to the requesting socket only with a
 * `system:probe:result` carrying the same `requestId`. Add capabilities by
 * registering queries, never by adding new message types.
 */
export class SystemProbeHandler implements MessageHandler {
  private registry: ConnectionRegistry;
  private projectManager: ProjectManager;
  private graphStore: ProjectGraphStore;

  constructor(
    registry: ConnectionRegistry,
    projectManager: ProjectManager,
    graphStore: ProjectGraphStore,
  ) {
    this.registry = registry;
    this.projectManager = projectManager;
    this.graphStore = graphStore;
  }

  handle(ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    if (!isSystemProbeRequest(message.payload)) {
      Logger.warn('[probe] invalid system:probe payload');
      return;
    }

    const { requestId, query, args } = message.payload;
    const fn = getProbeQuery(query);

    if (!fn) {
      this.reply(ws, { requestId, query, ok: false, error: `unknown query: ${query}` });
      return;
    }

    const ctx: ProbeContext = {
      registry: this.registry,
      projectManager: this.projectManager,
      graphStore: this.graphStore,
    };

    try {
      const data = fn(ctx, args);
      this.reply(ws, { requestId, query, ok: true, data });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      Logger.warn(`[probe] query "${query}" failed: ${error}`);
      this.reply(ws, { requestId, query, ok: false, error });
    }
  }

  private reply(ws: WebSocket, payload: Record<string, unknown>): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ message: { type: 'system:probe:result', payload } }));
  }
}
