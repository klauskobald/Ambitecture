export interface StatsToolOptions {
  emaK?: number;
  displayInterval?: number;
  displayFn?: (snapshot: Record<string, number>) => void;
}

interface KeyState {
  lastTsMs: number;
  emaPerSec: number;
}

const defaultOptions: Required<StatsToolOptions> = {
  emaK: 10,
  displayInterval: 5,
  displayFn: (v) => {
    for (const [label, n] of Object.entries(v)) {
      console.log(`${label}: ${n}`);
    }
  },
};

class StatsTool {
  private options: Required<StatsToolOptions> = { ...defaultOptions };
  private readonly perKey = new Map<string, KeyState>();
  private displayTimer: ReturnType<typeof setInterval> | undefined;

  setup(options: StatsToolOptions): void {
    this.options = {
      emaK: options.emaK ?? this.options.emaK,
      displayInterval: options.displayInterval ?? this.options.displayInterval,
      displayFn: options.displayFn ?? this.options.displayFn,
    };

    if (this.displayTimer !== undefined) {
      clearInterval(this.displayTimer);
      this.displayTimer = undefined;
    }

    const ms = Math.max(1, this.options.displayInterval) * 1000;
    this.displayTimer = setInterval(() => this.emitDisplay(), ms);
  }

  sample(key: string, value: number): void {
    const now = Date.now();
    let state = this.perKey.get(key);
    if (state === undefined) {
      state = { lastTsMs: now, emaPerSec: 0 };
      this.perKey.set(key, state);
    }

    const dtSec = (now - state.lastTsMs) / 1000;
    if (dtSec > 0 && value >= 0) {
      const instantPerSec = value / dtSec;
      const K = this.options.emaK;
      const alpha = 1 - Math.exp(-dtSec / K);
      state.emaPerSec = state.emaPerSec * (1 - alpha) + instantPerSec * alpha;
    }
    state.lastTsMs = now;
  }

  private emitDisplay(): void {
    if (this.perKey.size === 0) {
      return;
    }
    const snapshot: Record<string, number> = {};
    for (const [key, st] of this.perKey) {
      snapshot[`${key}/s`] = Math.round(st.emaPerSec);
    }
    this.options.displayFn(snapshot);
  }
}

export const statsTool = new StatsTool();
