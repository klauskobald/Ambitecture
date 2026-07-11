/**
 * HSV lerp helpers for NeewerBus smoothing.
 * Run: `npm run test:lerp-hsv` from modules/renderers/neewer
 */
import {
    computeChaseStep,
    hsvWithinDeadband,
    lerpHsv,
    lerpHueShortest,
    roundHsvForProtocol,
} from '../../src/lerpHsv';

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function assertNear(actual: number, expected: number, eps: number, msg: string): void {
    if (Math.abs(actual - expected) > eps) {
        throw new Error(`${msg}: got ${actual}, expected ${expected} ± ${eps}`);
    }
}

assertNear(lerpHueShortest(0, 90, 0.5), 45, 0.001, 'midpoint on short arc');
assertNear(lerpHueShortest(350, 10, 0.5), 0, 0.001, 'short arc across 0° wrap');
assertNear(lerpHueShortest(10, 350, 0.5), 0, 0.001, 'short arc reverse across 0° wrap');
assertNear(lerpHueShortest(60, 60, 0.5), 60, 0.001, 'identical hue');

const endpoints = lerpHsv({ h: 30, s: 50, v: 80 }, { h: 90, s: 100, v: 20 }, 0);
assertNear(endpoints.h, 30, 0.001, 't=0 hue');
assertNear(endpoints.s, 50, 0.001, 't=0 sat');
assertNear(endpoints.v, 80, 0.001, 't=0 val');

const end = lerpHsv({ h: 30, s: 50, v: 80 }, { h: 90, s: 100, v: 20 }, 1);
assertNear(end.h, 90, 0.001, 't=1 hue');
assertNear(end.s, 100, 0.001, 't=1 sat');
assertNear(end.v, 20, 0.001, 't=1 val');

const mid = lerpHsv({ h: 30, s: 50, v: 80 }, { h: 90, s: 100, v: 20 }, 0.5);
assertNear(mid.h, 60, 0.001, 't=0.5 hue');
assertNear(mid.s, 75, 0.001, 't=0.5 sat');
assertNear(mid.v, 50, 0.001, 't=0.5 val');

const wrapped = lerpHsv({ h: 350, s: 0, v: 100 }, { h: 10, s: 0, v: 100 }, 0.5);
assertNear(wrapped.h, 0, 0.001, 'wrapped hue midpoint');

assert(
    roundHsvForProtocol(356.4, 18.6, 100.2).s === 19,
    'protocol round saturation',
);

const db = { h: 1, s: 2, v: 2 };
assert(
    hsvWithinDeadband({ h: 356, s: 18, v: 100 }, { h: 356, s: 17, v: 100 }, db),
    'deadband sat tolerance',
);

const chase = computeChaseStep({ h: 0, s: 0, v: 0 }, { h: 100, s: 100, v: 100 }, 4, db);
assert(chase.colorToSend !== null && chase.continueChase, 'chase step continues toward far target');

console.log('lerpHsv.test.ts: all passed');
