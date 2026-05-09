import { WebSocket } from 'ws';
import { Logger } from './Logger';

export interface DiscoveryUiDescriptor {
  kind: string;
  url: string;
}

export interface DiscoveryWsDescriptor {
  kind: string;
  url: string;
}

export interface DiscoveryInterfaceEntry {
  ui?: DiscoveryUiDescriptor;
  ws?: DiscoveryWsDescriptor;
}

export interface DiscoveryEntry {
  controllerGuid: string;
  interfaces: Record<string, DiscoveryInterfaceEntry>;
}

export interface DiscoveryDeltaPayload {
  op: 'upsert' | 'remove';
  entry?: DiscoveryEntry;
  controllerGuid?: string;
}

function isDiscoveryInterfaceEntry(value: unknown): value is DiscoveryInterfaceEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const ui = v['ui'];
  const ws = v['ws'];
  if (ui !== undefined) {
    if (!ui || typeof ui !== 'object' || Array.isArray(ui)) return false;
    const u = ui as Record<string, unknown>;
    if (typeof u['kind'] !== 'string' || typeof u['url'] !== 'string') return false;
  }
  if (ws !== undefined) {
    if (!ws || typeof ws !== 'object' || Array.isArray(ws)) return false;
    const w = ws as Record<string, unknown>;
    if (typeof w['kind'] !== 'string' || typeof w['url'] !== 'string') return false;
  }
  return true;
}

export function parseDiscoveryFromRegisterPayload(payload: unknown): DiscoveryEntry | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const root = payload as Record<string, unknown>;
  const raw = root['discovery'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const interfacesRaw = (raw as Record<string, unknown>)['interfaces'];
  if (!interfacesRaw || typeof interfacesRaw !== 'object' || Array.isArray(interfacesRaw)) return null;
  const interfaces: Record<string, DiscoveryInterfaceEntry> = {};
  for (const [key, val] of Object.entries(interfacesRaw)) {
    if (!key || !isDiscoveryInterfaceEntry(val)) continue;
    interfaces[key] = val;
  }
  if (Object.keys(interfaces).length === 0) return null;
  const guid = typeof root['guid'] === 'string' ? root['guid'] : '';
  if (!guid) return null;
  return { controllerGuid: guid, interfaces };
}

export class DiscoveryService {
  private entries = new Map<string, DiscoveryEntry>();
  private socketForGuid = new Map<string, WebSocket>();
  private guidForSocket = new Map<WebSocket, string>();
  private subscribers = new Set<WebSocket>();

  subscribe(ws: WebSocket): void {
    this.subscribers.add(ws);
    const list = [...this.entries.values()];
    this.sendSnapshot(ws, list);
    Logger.info(`[discovery] subscribe from socket (${list.length} entr(y|ies) in snapshot)`);
  }

  unsubscribe(ws: WebSocket): void {
    this.subscribers.delete(ws);
  }

  onControllerRegistered(ws: WebSocket, entry: DiscoveryEntry): void {
    const guid = entry.controllerGuid;
    this.entries.set(guid, entry);
    this.socketForGuid.set(guid, ws);
    this.guidForSocket.set(ws, guid);
    this.broadcastDelta({ op: 'upsert', entry });
    Logger.info(`[discovery] upsert ${guid}`);
  }

  onControllerDiscoveryCleared(ws: WebSocket): void {
    const guid = this.guidForSocket.get(ws);
    if (!guid) return;
    this.removeByGuid(guid, ws);
  }

  onSocketClosed(ws: WebSocket): void {
    this.subscribers.delete(ws);
    const guid = this.guidForSocket.get(ws);
    if (!guid) return;
    this.removeByGuid(guid, ws);
  }

  private removeByGuid(guid: string, ws: WebSocket): void {
    if (this.socketForGuid.get(guid) !== ws) return;
    this.entries.delete(guid);
    this.socketForGuid.delete(guid);
    this.guidForSocket.delete(ws);
    this.broadcastDelta({ op: 'remove', controllerGuid: guid });
    Logger.info(`[discovery] remove ${guid}`);
  }

  private sendSnapshot(ws: WebSocket, entries: DiscoveryEntry[]): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({
      message: {
        type: 'discovery:snapshot',
        payload: { entries },
      },
    }));
  }

  private broadcastDelta(delta: DiscoveryDeltaPayload): void {
    const msg = JSON.stringify({
      message: {
        type: 'discovery:delta',
        payload: delta,
      },
    });
    for (const sub of this.subscribers) {
      if (sub.readyState === sub.OPEN) sub.send(msg);
    }
  }
}
