import { WebSocket } from 'ws';
import { buildBindingValueMessage } from './BindingProtocol';

type MasterEntry = {
  getDataFn: () => unknown;
  setDataFn: (value: unknown) => void;
};

/**
 * Bidirectional hub property binding. Masters register a key with get/set fns.
 * Slaves (controller sockets) subscribe to a key and receive value updates.
 * Master never caches — always queries via getDataFn. Pending slave values
 * are held when no master is registered and applied when master appears.
 */
export class BindingManager {
  private masters      = new Map<string, MasterEntry>();
  private slaves       = new Map<string, Set<WebSocket>>();
  private pendingValue = new Map<string, unknown>();

  registerMaster(key: string, getDataFn: () => unknown, setDataFn: (value: unknown) => void): void {
    this.masters.set(key, { getDataFn, setDataFn });
    if (this.pendingValue.has(key)) {
      setDataFn(this.pendingValue.get(key));
      this.pendingValue.delete(key);
    }
    const currentSlaves = this.slaves.get(key);
    if (currentSlaves?.size) {
      const msg = buildBindingValueMessage(key, getDataFn());
      for (const ws of currentSlaves) this.sendIfOpen(ws, msg);
    }
  }

  unregisterMaster(key: string): void {
    this.masters.delete(key);
    const currentSlaves = this.slaves.get(key);
    if (currentSlaves?.size) {
      const msg = buildBindingValueMessage(key, null);
      for (const ws of currentSlaves) this.sendIfOpen(ws, msg);
    }
  }

  receiveFromMaster(key: string, value: unknown): void {
    const currentSlaves = this.slaves.get(key);
    if (!currentSlaves?.size) return;
    const msg = buildBindingValueMessage(key, value);
    for (const ws of currentSlaves) this.sendIfOpen(ws, msg);
  }

  handleSubscribe(ws: WebSocket, key: string): void {
    let set = this.slaves.get(key);
    if (!set) {
      set = new Set();
      this.slaves.set(key, set);
    }
    set.add(ws);
    const master = this.masters.get(key);
    if (master) {
      this.sendIfOpen(ws, buildBindingValueMessage(key, master.getDataFn()));
    }
  }

  handleSet(key: string, value: unknown): void {
    const master = this.masters.get(key);
    if (master) {
      master.setDataFn(value);
    } else {
      this.pendingValue.set(key, value);
    }
  }

  onSocketClosed(ws: WebSocket): void {
    for (const set of this.slaves.values()) {
      set.delete(ws);
    }
  }

  private sendIfOpen(ws: WebSocket, msg: string): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}
