/**
 * Chase + deadband step logic for NeewerBus.
 * Run: `npm run test:chase` from modules/renderers/neewer
 */
import { computeChaseStep, hsvWithinDeadband, roundHsvForProtocol } from '../../src/lerpHsv';

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function assertNear(actual: number, expected: number, eps: number, msg: string): void {
    if (Math.abs(actual - expected) > eps) {
        throw new Error(`${msg}: got ${actual}, expected ${expected} ± ${eps}`);
    }
}

const db = { h: 1, s: 2, v: 2 };

assert(
    hsvWithinDeadband({ h: 356, s: 18, v: 100 }, { h: 356, s: 17, v: 100 }, db),
    'sat change of 1 within deadband 2',
);
assert(
    !hsvWithinDeadband({ h: 356, s: 18, v: 100 }, { h: 354, s: 18, v: 100 }, db),
    'hue change of 2 exceeds deadband 1',
);

const skipTiny = computeChaseStep({ h: 356, s: 18, v: 100 }, { h: 356, s: 17, v: 100 }, 5, db);
assert(skipTiny.arrived, 'tiny target delta should count as arrived');
assert(!skipTiny.continueChase, 'no chase after arrived');

const chaseFar = computeChaseStep({ h: 0, s: 0, v: 0 }, { h: 120, s: 100, v: 100 }, 5, db);
assert(chaseFar.colorToSend !== null, 'large delta produces a chase step');
assert(chaseFar.continueChase, 'large delta keeps chasing');
assertNear(chaseFar.colorToSend!.h, 24, 0.001, 'one fifth toward 120° hue');

const snapNear = computeChaseStep({ h: 119, s: 99, v: 99 }, { h: 120, s: 100, v: 100 }, 5, db);
assert(snapNear.arrived, 'step near target snaps');
assert(
    roundHsvForProtocol(snapNear.colorToSend!.h, snapNear.colorToSend!.s, snapNear.colorToSend!.v).h === 120,
    'snap uses protocol-rounded target',
);

const deadbandSkip = computeChaseStep({ h: 100, s: 50, v: 50 }, { h: 100, s: 46, v: 50 }, 5, db);
assert(deadbandSkip.colorToSend === null, 'sub-deadband chase step skips write');
assert(deadbandSkip.continueChase, 'still chasing after deadband skip');

console.log('neewerBusChase.test.ts: all passed');
