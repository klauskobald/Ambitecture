export interface StrobeConfig {
    lowFrequency: number;
    highFrequency: number;
    onTime: number;
}

const DEFAULT_STROBE: StrobeConfig = {
    lowFrequency: 0.5,
    highFrequency: 10,
    onTime: 0.02,
};

function readNumber(raw: Record<string, unknown>, key: keyof StrobeConfig, fallback: number): number {
    const value = raw[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function parseStrobeConfig(raw: unknown): StrobeConfig {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ...DEFAULT_STROBE };
    }
    const o = raw as Record<string, unknown>;
    return {
        lowFrequency: readNumber(o, 'lowFrequency', DEFAULT_STROBE.lowFrequency),
        highFrequency: readNumber(o, 'highFrequency', DEFAULT_STROBE.highFrequency),
        onTime: readNumber(o, 'onTime', DEFAULT_STROBE.onTime),
    };
}

export type StrobeEmit = (hue: number, sat: number, bri: number) => void;

/**
 * Simulates a strobe on a Neewer lamp, which has no strobe channel: a self-rescheduling
 * timer alternates between emitting the lamp's target brightness ("on") and zero ("off").
 * The renderer is otherwise edge-triggered (sends only on intent change), so the timer is
 * what keeps the flashing alive while intents are static.
 */
export class StrobeScheduler {
    private readonly config: StrobeConfig;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private hue = 0;
    private sat = 0;
    private bri = 0;
    private strobeValue = 0;
    private emit: StrobeEmit = () => undefined;

    constructor(config: StrobeConfig) {
        this.config = config;
    }

    update(hue: number, sat: number, bri: number, strobeValue: number, emit: StrobeEmit): void {
        this.hue = hue;
        this.sat = sat;
        this.bri = bri;
        this.strobeValue = strobeValue;
        this.emit = emit;
        if (this.timer === null) {
            this.enterOnPhase();
        }
    }

    stop(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private enterOnPhase(): void {
        this.emit(this.hue, this.sat, this.bri);
        this.timer = setTimeout(() => this.enterOffPhase(), this.onMs());
    }

    private enterOffPhase(): void {
        this.emit(this.hue, this.sat, 0);
        this.timer = setTimeout(() => this.enterOnPhase(), this.periodMs() - this.onMs());
    }

    // The on flash is the configured onTime, but never more than half the period, so a
    // high frequency (short period) still leaves an equal off phase instead of staying lit.
    private onMs(): number {
        return Math.min(this.config.onTime * 1000, this.periodMs() / 2);
    }

    private periodMs(): number {
        const { lowFrequency, highFrequency } = this.config;
        const freq = lowFrequency + this.strobeValue * (highFrequency - lowFrequency);
        return freq > 0 ? 1000 / freq : Number.POSITIVE_INFINITY;
    }
}
