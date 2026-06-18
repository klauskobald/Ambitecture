import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { Logger } from './Logger';
import { PluginServerConfig } from './Config';
import { AssignmentRecord } from './GraphReplica';

export interface PluginIntentRow {
  guid: string;
  name: string;
}

export interface PluginServerHandlers {
  getAssignments: () => AssignmentRecord[];
  getIntentsForPlugin: () => PluginIntentRow[];
  getSystemCapabilities: () => unknown | null;
  getIntentClasses: () => Record<string, string>;
  summarizeForPlugin: (a: AssignmentRecord) => string;
  onSave: (assignments: unknown[]) => void;
  onLearnStart: (
    assignmentGuid: string,
    field: string,
    capture?: 'noteOn' | 'controlChange' | 'any',
  ) => void;
  onLearnStop: (assignmentGuid: string, field: string) => void;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

export class PluginServer {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly clients = new Set<WebSocket>();

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
      this.clients.add(ws);
      this.pushStateTo(ws);
      ws.on('message', raw => this.onClientMessage(ws, raw));
      ws.on('close', () => {
        this.clients.delete(ws);
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
    for (const ws of this.clients) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
    if (this.server !== null) {
      this.server.close();
      this.server = null;
    }
  }

  pushState(): void {
    const payload = this.buildStatePayload();
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }

  private pushStateTo(ws: WebSocket): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(this.buildStatePayload());
  }

  private buildStatePayload(): string {
    const summarize = this.handlers.summarizeForPlugin;
    const assignments = this.handlers.getAssignments().map(a => assignmentToWire(a, summarize(a)));
    const intents = this.handlers.getIntentsForPlugin();
    const systemCapabilities = this.handlers.getSystemCapabilities();
    const intentClasses = this.handlers.getIntentClasses();
    return JSON.stringify({
      type: 'state',
      assignments,
      intents,
      systemCapabilities,
      intentClasses,
    });
  }

  sendLearnResult(
    assignmentGuid: string,
    field: string,
    value?: number,
    device?: string,
    channel?: number,
  ): void {
    const payload: Record<string, unknown> = { type: 'learnValue', assignmentGuid, field };
    if (typeof value === 'number' && Number.isFinite(value)) payload['value'] = value;
    if (typeof device === 'string') payload['device'] = device;
    if (typeof channel === 'number' && Number.isFinite(channel)) payload['channel'] = channel;
    const msg = JSON.stringify(payload);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  sendAssignmentTrigger(assignmentGuid: string, input?: number, result?: number): void {
    const payload: Record<string, unknown> = { type: 'assignmentTrigger', assignmentGuid };
    if (typeof input === 'number' && Number.isFinite(input)) payload['input'] = input;
    if (typeof result === 'number' && Number.isFinite(result)) payload['result'] = result;
    const msg = JSON.stringify(payload);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  sendAssignmentEngaged(assignmentGuid: string, engaged: boolean): void {
    const msg = JSON.stringify({
      type: 'assignmentEngaged',
      assignmentGuid,
      engaged,
    });
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
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

  private onClientMessage(sender: WebSocket, raw: RawData): void {
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
      const capRaw = msg['capture'];
      const capture =
        capRaw === 'noteOn' || capRaw === 'controlChange' || capRaw === 'any' ? capRaw : undefined;
      if (typeof guid === 'string' && typeof field === 'string') {
        this.handlers.onLearnStart(guid, field, capture);
        if (sender.readyState === WebSocket.OPEN) {
          sender.send(
            JSON.stringify({
              type: 'learnWaiting',
              assignmentGuid: guid,
              field,
              ...(capture !== undefined ? { capture } : {}),
            }),
          );
        }
      }
      return;
    }
    if (type === 'learnStop') {
      const guid = msg['assignmentGuid'];
      const field = msg['field'];
      if (typeof guid === 'string' && typeof field === 'string') {
        this.handlers.onLearnStop(guid, field);
      }
    }
  }
}

function assignmentToWire(a: AssignmentRecord, summary: string): Record<string, unknown> {
  return {
    class: a.class,
    guid: a.guid,
    channel: a.channel,
    channelAny: a.channelAny,
    device: a.device,
    deviceAny: a.deviceAny,
    params: { ...a.params },
    targets: a.targets.map(t => ({ ...t })),
    summary,
  };
}
