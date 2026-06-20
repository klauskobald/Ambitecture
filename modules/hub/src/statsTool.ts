export interface StatsToolOptions {
  emaK?: number;
  displayInterval?: number;
  displayFn?: (snapshot: Record<string, number>) => void;
}

interface KeyState {
  acc: number;
  value: number;
  readout: number;
  multiplier: number;
  units: string;
}

const defaultOptions: Required<StatsToolOptions> = {
  emaK: 1,
  displayInterval: 5,
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

  sample(key: string, value: number, multiplier: number = 1, units: string = ''): void {
    let state = this.perKey.get(key);
    if (state === undefined) {
      state = { value: 0, multiplier, acc: 0, readout: 0, units };
      this.perKey.set(key, state);
    }
    state.acc += value;
    state.units = units;
  }

  private emitMeter(): void {
    for (const [key, state] of this.perKey) {
      if (state.acc > state.value) state.value = state.acc;
      state.readout = state.value;
      state.value *= this.meterReleaseFactor;
      state.acc = 0;
      this.perKey.set(key, state);
    }
  }

  private emitDisplay(): void {
    if (this.perKey.size === 0) {
      return;
    }
    const snapshot: Record<string, number> = {};
    for (const [key, st] of this.perKey) {
      snapshot[`${key}${st.units ? "/" + st.units : ''}`] = Math.round(st.value * st.multiplier * this.meterReleaseFactor);
    }
    this.options.displayFn(snapshot);
  }
}

export const statsTool = new StatsTool();
