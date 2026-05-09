export interface StatsToolOptions {
  emaK?: number;
  displayInterval?: number;
  displayFn?: (snapshot: Record<string, number>) => void;
}

interface KeyState {
  value: number;
  multiplier: number;
}

const defaultOptions: Required<StatsToolOptions> = {
  emaK: 1,
  displayInterval: 1,
  displayFn: (v) => {
    const str = []
    for (const [label, n] of Object.entries(v)) {
      str.push(`${label}: ${n}`.padEnd(17, ' '));
    }
    console.log(str.join(' '));
  },
};

class StatsTool {
  private options: Required<StatsToolOptions> = { ...defaultOptions };
  private readonly perKey = new Map<string, KeyState>();
  private displayTimer: ReturnType<typeof setInterval> | undefined;
  private meterTimer: ReturnType<typeof setInterval> | undefined;
  private meterReleaseFactor: number = 0;

  setup(options: StatsToolOptions): void {
    this.options = {
      emaK: options.emaK ?? this.options.emaK,
      displayInterval: options.displayInterval ?? this.options.displayInterval,
      displayFn: options.displayFn ?? this.options.displayFn,
    };

    if (this.displayTimer !== undefined) {
      clearInterval(this.displayTimer);
      clearInterval(this.meterTimer);
      this.displayTimer = undefined;
      this.meterTimer = undefined;
    }

    const ms = Math.max(1, this.options.displayInterval) * 1000;
    this.displayTimer = setInterval(() => this.emitDisplay(), ms);
    this.meterTimer = setInterval(() => this.emitMeter(), 1000);
    this.meterReleaseFactor = 1 - 1 / (1 + this.options.emaK);
  }

  sample(key: string, value: number, multiplier: number = 1): void {
    let state = this.perKey.get(key);
    if (state === undefined) {
      state = { value: 0, multiplier };
      this.perKey.set(key, state);
    }
    state.value += value;
  }

  private emitMeter(): void {
    for (const [key, state] of this.perKey) {
      state.value *= this.meterReleaseFactor;
      this.perKey.set(key, state);
    }
  }

  private emitDisplay(): void {
    if (this.perKey.size === 0) {
      return;
    }
    const snapshot: Record<string, number> = {};
    for (const [key, st] of this.perKey) {
      snapshot[`${key}/s`] = Math.round(st.value * st.multiplier * this.meterReleaseFactor);
    }
    this.options.displayFn(snapshot);
  }
}

export const statsTool = new StatsTool();
