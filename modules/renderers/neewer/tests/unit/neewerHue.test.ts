/**
 * Neewer perceptual → protocol hue warp (yellow anchor).
 * Run: `npm run test:neewer-hue` from modules/renderers/neewer
 */
import {
    evaluateNeewerHue,
    hueDistanceDeg,
    mapNeewerHue,
    normalizeHue,
} from '../../src/neewerHue';

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function assertNear(actual: number, expected: number, eps: number, msg: string): void {
    if (Math.abs(actual - expected) > eps) {
        throw new Error(`${msg}: got ${actual}, expected ${expected} ± ${eps}`);
    }
}

assert(mapNeewerHue(60) === 48, 'perceptual yellow 60° should map to device 48°');

assertNear(mapNeewerHue(0), 0, 0.001, 'red should be unchanged');
assertNear(mapNeewerHue(180), 180, 0.001, 'cyan should be unchanged');

assertNear(mapNeewerHue(20), 20, 0.001, '20° outside bend width should be unchanged');
assertNear(mapNeewerHue(100), 100, 0.001, '100° outside bend width should be unchanged');

const insideBend = mapNeewerHue(50);
assert(
    insideBend < 50 && insideBend > 38,
    `50° should be partially corrected toward device yellow, got ${insideBend}`
);

assert(hueDistanceDeg(359, 60) > 40, '359° should be far from yellow on short arc');

const wrapped = mapNeewerHue(359);
assertNear(wrapped, 359, 0.001, '359° should be unchanged (far from yellow)');

assert(normalizeHue(-10) === 350, 'normalizeHue negative');
assert(normalizeHue(370) === 10, 'normalizeHue overflow');

assert(evaluateNeewerHue('neewerHue', 60) === 48, 'evaluateNeewerHue by name');
assert(evaluateNeewerHue('unknown', 60) === 60, 'unknown function passes through');
assert(evaluateNeewerHue(undefined, 60) === 60, 'missing function passes through');

console.log('neewerHue.test.ts: all passed');
