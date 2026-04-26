import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Logger } from './Logger';
import { ConnectionRegistry } from './ConnectionRegistry';
import { MessageRouter, WsMessage } from './MessageRouter';

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 15_000;

interface ParsedEnvelope {
  message: WsMessage;
}

function isParsedEnvelope(value: unknown): value is ParsedEnvelope {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const v = value as Record<string, unknown>;
  const msg = v['message'];
  if (!msg || typeof msg !== 'object') {
    return false;
  }
  return typeof (msg as Record<string, unknown>)['type'] === 'string';
}

export class Server {
  private registry: ConnectionRegistry;
  private router: MessageRouter;
  private httpServer: http.Server;
  private wss: WebSocketServer;
  private lastPongTimes: Map<WebSocket, number> = new Map();

  constructor(registry: ConnectionRegistry, router: MessageRouter) {
    this.registry = registry;
    this.router = router;
    this.httpServer = http.createServer();
    this.wss = new WebSocketServer({
      server: this.httpServer,
      perMessageDeflate: { threshold: 1024 },
    });
    this.wss.on('connection', (ws) => this.onConnection(ws));
  }

  listen(port: number, host: string): void {
    this.httpServer.listen(port, host);
  }

  private onConnection(ws: WebSocket): void {
    this.registry.add(ws);
    this.lastPongTimes.set(ws, Date.now());

    const heartbeatTimer = setInterval(() => this.checkHeartbeat(ws), HEARTBEAT_INTERVAL_MS);

    ws.on('message', (raw) => this.onMessage(ws, raw.toString()));
    ws.on('pong', () => this.onPong(ws));

    ws.on('close', () => {
      clearInterval(heartbeatTimer);
      this.registry.remove(ws);
      this.lastPongTimes.delete(ws);
    });

    ws.on('error', (err) => {
      Logger.error('[ws] Connection error', err);
      clearInterval(heartbeatTimer);
      this.registry.remove(ws);
      this.lastPongTimes.delete(ws);
    });
  }

  private onMessage(ws: WebSocket, raw: string): void {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isParsedEnvelope(parsed)) {
        Logger.warn('[ws] Received malformed envelope');
        return;
      }
      this.router.route(ws, parsed.message);
    } catch (err) {
      Logger.exception(err);
    }
  }

  private onPong(ws: WebSocket): void {
    this.lastPongTimes.set(ws, Date.now());
  }

  private checkHeartbeat(ws: WebSocket): void {
    const lastPong = this.lastPongTimes.get(ws);
    const msSinceLastPong = lastPong !== undefined ? Date.now() - lastPong : Infinity;

    const isHeartbeatTimedOut = msSinceLastPong > HEARTBEAT_TIMEOUT_MS;
    if (isHeartbeatTimedOut) {
      Logger.warn('[ws] Heartbeat timeout — terminating connection');
      ws.terminate();
      return;
    }

    ws.ping();
  }
}
