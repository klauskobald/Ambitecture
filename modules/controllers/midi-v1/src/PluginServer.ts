import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { Logger } from './Logger';
import { PluginServerConfig } from './Config';
import { AssignmentRecord } from './GraphReplica';

export interface PluginServerHandlers {
  getAssignments: () => AssignmentRecord[];
  onSave: (assignments: unknown[]) => void;
  onLearnStart: (assignmentGuid: string, field: string) => void;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

export class PluginServer {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;

  constructor(
    private readonly pluginConfig: PluginServerConfig,
    private readonly handlers: PluginServerHandlers,
    private readonly logger: Logger,
  ) {}

  start(uiDir: string): void {
    if (this.server !== null) return;
    const resolvedUi = path.resolve(uiDir);

    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on('connection', ws => {
      if (this.client !== null) {
        try {
          this.client.close(4000, 'replaced');
        } catch {
          /* ignore */
        }
      }
      this.client = ws;
      this.pushState();
      ws.on('message', raw => this.onClientMessage(raw));
      ws.on('close', () => {
        if (this.client === ws) this.client = null;
      });
    });

    this.server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end();
        return;
      }
      const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/assign.html')) {
        this.serveFile(res, path.join(resolvedUi, 'assign.html'));
        return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/')) {
        const rel = url.pathname.slice(1);
        const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
        const filePath = path.join(resolvedUi, safe);
        if (!filePath.startsWith(resolvedUi)) {
          res.writeHead(403);
          res.end();
          return;
        }
        this.serveFile(res, filePath);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    this.server.on('upgrade', (request, socket, head) => {
      const host = request.headers.host ?? `127.0.0.1:${this.pluginConfig.listenPort}`;
      const url = new URL(request.url ?? '', `http://${host}`);
      if (url.pathname === '/ws') {
        this.wss?.handleUpgrade(request, socket, head, ws => {
          this.wss?.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    this.server.listen(this.pluginConfig.listenPort, '0.0.0.0', () => {
      this.logger.info(
        `plugin UI http://0.0.0.0:${this.pluginConfig.listenPort} (browser: http://${this.pluginConfig.publicHost}:${this.pluginConfig.listenPort})`,
      );
    });
  }

  stop(): void {
    if (this.client !== null) {
      try {
        this.client.close();
      } catch {
        /* ignore */
      }
      this.client = null;
    }
    this.wss?.close();
    this.wss = null;
    if (this.server !== null) {
      this.server.close();
      this.server = null;
    }
  }

  pushState(): void {
    const ws = this.client;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const assignments = this.handlers.getAssignments().map(a => assignmentToWire(a));
    ws.send(JSON.stringify({ type: 'state', assignments }));
  }

  sendLearnResult(assignmentGuid: string, field: string, value: number): void {
    const ws = this.client;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'learnValue', assignmentGuid, field, value }));
  }

  private serveFile(res: http.ServerResponse, filePath: string): void {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(err.code === 'ENOENT' ? 404 : 500);
        res.end();
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
      res.writeHead(200);
      res.end(data);
    });
  }

  private onClientMessage(raw: RawData): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = msg['type'];
    if (type === 'save') {
      const assignments = msg['assignments'];
      if (Array.isArray(assignments)) this.handlers.onSave(assignments);
      return;
    }
    if (type === 'learnStart') {
      const guid = msg['assignmentGuid'];
      const field = msg['field'];
      if (typeof guid === 'string' && typeof field === 'string') {
        this.handlers.onLearnStart(guid, field);
        const ws = this.client;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'learnWaiting', assignmentGuid: guid, field }));
        }
      }
    }
  }
}

function assignmentToWire(a: AssignmentRecord): Record<string, unknown> {
  return {
    class: a.class,
    guid: a.guid,
    channel: a.channel,
    params: { ...a.params },
    targets: a.targets.map(t => ({ ...t })),
  };
}
