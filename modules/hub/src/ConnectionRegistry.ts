import { WebSocket } from 'ws';

export interface ClientInfo {
  role: 'renderer' | 'controller' | 'unknown';
  guid: string;
  location?: [number, number];
  meta: Record<string, unknown>;
}

export class ConnectionRegistry {
  private clients: Map<WebSocket, ClientInfo> = new Map();

  add(ws: WebSocket): void {
    this.clients.set(ws, { role: 'unknown', guid: '', meta: {} });
  }

  update(ws: WebSocket, info: Partial<ClientInfo>): void {
    const existing = this.clients.get(ws);
    if (!existing) {
      return;
    }
    this.clients.set(ws, { ...existing, ...info });
  }

  remove(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  get(ws: WebSocket): ClientInfo | undefined {
    return this.clients.get(ws);
  }

  getByRole(role: 'renderer' | 'controller'): WebSocket[] {
    const result: WebSocket[] = [];
    for (const [ws, info] of this.clients) {
      if (info.role === role) {
        result.push(ws);
      }
    }
    return result;
  }
}
