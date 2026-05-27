/**
 * Strobe on/off timing for Neewer lamps (brightness-gated, timer-driven).
 * Run: `npm run test:strobe` from modules/renderers/neewer
 */
import { StrobeScheduler, parseStrobeConfig } from '../../src/StrobeScheduler';

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function assertNear(actual: number, expected: number, eps: number, msg: string): void {
    if (Math.abs(actual - expected) > eps) {
        throw new Error(`${msg}: got ${actual}, expected ${expected} ± ${eps}`);
    }
}

// Single-slot fake timer: the scheduler only ever keeps one timer armed at a time.
let pending: { cb: () => void; delayMs: number } | null = null;
const realSetTimeout = global.setTimeout;
const realClearTimeout = global.clearTimeout;
global.setTimeout = ((cb: () => void, delay?: number) => {
    pending = { cb, delayMs: delay ?? 0 };
    return 1 as unknown as ReturnType<typeof setTimeout>;
}) as typeof setTimeout;
global.clearTimeout = (() => {
    pending = null;
}) as typeof clearTimeout;

function fire(): void {
    if (!pending) throw new Error('no pending timer to fire');
    const { cb } = pending;
    pending = null;
    cb();
}

function nextDelay(): number {
    if (!pending) throw new Error('no pending timer armed');
    return pending.delayMs;
}

type Emit = [number, number, number];

try {
    // config defaults fill missing keys
    const filled = parseStrobeConfig({ lowFrequency: 2 });
    assert(filled.highFrequency === 10 && filled.onTime === 0.02, 'missing strobe keys take defaults');

    // strobeValue 0.5 → freq = 0.5 + 0.5*(10-0.5) = 5.25 Hz → period ≈ 190.48ms, on 100ms, off ≈ 90.48ms
    const config = { lowFrequency: 0.5, highFrequency: 10, onTime: 0.1 };
    const emits: Emit[] = [];
    const emit = (h: number, s: number, b: number): void => {
        emits.push([h, s, b]);
    };

    const scheduler = new StrobeScheduler(config);
    scheduler.update(200, 50, 80, 0.5, emit);

    assert(emits.length === 1, 'first update emits the on-phase immediately');
    assert(emits[0]![2] === 80, 'on-phase emits full target brightness');
    assertNear(nextDelay(), 100, 0.001, 'on-phase lasts onTime (0.1s)');

    fire();
    assert(emits.length === 2, 'off-phase emits once');
    assert(emits[1]![2] === 0, 'off-phase multiplies brightness to 0');
    assertNear(nextDelay(), 1000 / 5.25 - 100, 0.5, 'off-phase fills the rest of the period');

    fire();
    assert(emits.length === 3 && emits[2]![2] === 80, 'cycle returns to on-phase at full brightness');
    assertNear(nextDelay(), 100, 0.001, 'on-phase delay is stable across cycles');

    // an intent update mid-cycle stores the new target without an extra emit
    scheduler.update(120, 50, 80, 0.5, emit);
    assert(emits.length === 3, 'update while strobing does not emit out of phase');
    fire();
    assert(emits[3]![0] === 120, 'next phase uses the latest target hue');

    scheduler.stop();
    assert(pending === null, 'stop clears the armed timer');

    // strobeValue 1 → freq 10 Hz → period 100ms == onTime → never goes dark, stays on
    const fast = new StrobeScheduler(config);
    const fastEmits: Emit[] = [];
    fast.update(0, 0, 90, 1, (h, s, b) => fastEmits.push([h, s, b]));
    assert(fastEmits.length === 1 && fastEmits[0]![2] === 90, 'fast strobe starts on');
    fire();
    assert(fastEmits.length === 2 && fastEmits[1]![2] === 90, 'onTime ≥ period stays on (no dark frame)');
    fast.stop();

    console.log('strobeScheduler.test.ts: all passed');
} finally {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
}
