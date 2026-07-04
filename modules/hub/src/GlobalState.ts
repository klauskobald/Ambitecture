/**
 * Hub-wide key/value store with change notification. `setItem` emits the changed key to every
 * subscriber, which then reads only what it needs via `getItem`. Domain-free: it holds values and
 * fans out change events, nothing more. Exported as a singleton (same pattern as `configResolver`).
 *
 * First consumer: `editmode` — animations and pulses subscribe and pause/resume themselves.
 */
export const GLOBAL_STATE_KEYS = ['editmode'] as const;

export type GlobalStateKey = typeof GLOBAL_STATE_KEYS[number];

export interface GlobalStateShape {
  editmode: boolean;
}

type GlobalStateListener = (key: GlobalStateKey) => void;

class GlobalStateStore {
  private values = new Map<GlobalStateKey, GlobalStateShape[GlobalStateKey]>();
  private listeners = new Set<GlobalStateListener>();

  /** Store and emit; no-op (no event) when the value is unchanged. */
  setItem<K extends GlobalStateKey>(key: K, value: GlobalStateShape[K]): void {
    if (this.values.has(key) && Object.is(this.values.get(key), value)) {
      return;
    }
    this.values.set(key, value);
    for (const listener of this.listeners) {
      listener(key);
    }
  }

  getItem<K extends GlobalStateKey>(key: K): GlobalStateShape[K] | undefined {
    return this.values.get(key) as GlobalStateShape[K] | undefined;
  }

  /** @returns unsubscribe fn. Listener receives the changed key and reads the value it cares about. */
  subscribe(listener: GlobalStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const globalState = new GlobalStateStore();
