export const ENVELOPE_INTERVAL_MS = 50;

type Phase = 'idle' | 'attack' | 'sustain' | 'release';

export interface EnvArOptions {
  attackMs: number;
  releaseMs: number;
  onValue: (value01: number) => void;
}

export class EnvAr {
  private attackMs: number;
  private releaseMs: number;
  private readonly onValue: (value01: number) => void;
  private phase: Phase = 'idle';
  private level = 0;
  private attackElapsed = 0;
  private releaseElapsed = 0;
  private releaseStartLevel = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: EnvArOptions) {
    this.attackMs = Math.max(0, opts.attackMs);
    this.releaseMs = Math.max(0, opts.releaseMs);
    this.onValue = opts.onValue;
  }

  setParams(attackMs: number, releaseMs: number): void {
    this.attackMs = Math.max(0, attackMs);
    this.releaseMs = Math.max(0, releaseMs);
  }

  noteOn(): void {
    this.stopTimer();
    this.phase = 'attack';
    this.attackElapsed = 0;
    this.releaseElapsed = 0;

    if (this.attackMs <= 0) {
      this.level = 1;
      this.phase = 'sustain';
      this.onValue(1);
      return;
    }

    this.level = 0;
    this.onValue(0);
    this.startTimer();
  }

  noteOff(): void {
    if (this.phase === 'idle') return;

    this.releaseStartLevel = this.level;
    this.phase = 'release';
    this.releaseElapsed = 0;

    if (this.releaseMs <= 0) {
      this.level = 0;
      this.phase = 'idle';
      this.stopTimer();
      this.onValue(0);
      return;
    }

    if (!this.timer) this.startTimer();
    this.tick();
  }

  dispose(): void {
    this.stopTimer();
    this.phase = 'idle';
    this.level = 0;
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), ENVELOPE_INTERVAL_MS);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    switch (this.phase) {
      case 'attack': {
        this.attackElapsed += ENVELOPE_INTERVAL_MS;
        this.level = Math.min(1, this.attackElapsed / this.attackMs);
        this.onValue(this.level);
        if (this.level >= 1) {
          this.level = 1;
          this.phase = 'sustain';
          this.stopTimer();
        }
        break;
      }
      case 'release': {
        this.releaseElapsed += ENVELOPE_INTERVAL_MS;
        const t = Math.min(1, this.releaseElapsed / this.releaseMs);
        this.level = this.releaseStartLevel * (1 - t);
        this.onValue(this.level);
        if (t >= 1) {
          this.level = 0;
          this.phase = 'idle';
          this.stopTimer();
          this.onValue(0);
        }
        break;
      }
      default:
        this.stopTimer();
    }
  }
}
