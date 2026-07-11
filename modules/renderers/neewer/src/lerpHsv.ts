export interface HsvColor {
    h: number;
    s: number;
    v: number;
}

export interface HsvDeadband {
    h: number;
    s: number;
    v: number;
}

export interface ChaseStepResult {
    colorToSend: HsvColor | null;
    arrived: boolean;
    continueChase: boolean;
}

export function lerpHueShortest(a: number, b: number, t: number): number {
    const delta = ((b - a + 540) % 360) - 180;
    const h = a + delta * t;
    return ((h % 360) + 360) % 360;
}

export function lerpHsv(from: HsvColor, to: HsvColor, t: number): HsvColor {
    const clamped = Math.max(0, Math.min(1, t));
    return {
        h: lerpHueShortest(from.h, to.h, clamped),
        s: from.s + (to.s - from.s) * clamped,
        v: from.v + (to.v - from.v) * clamped,
    };
}

export function roundHsvForProtocol(h: number, s: number, v: number): HsvColor {
    return {
        h: Math.max(0, Math.min(360, Math.round(h))),
        s: Math.max(0, Math.min(100, Math.round(s))),
        v: Math.max(0, Math.min(100, Math.round(v))),
    };
}

function hueDistanceShortest(a: number, b: number): number {
    return Math.abs(((b - a + 540) % 360) - 180);
}

export function hsvWithinDeadband(a: HsvColor, b: HsvColor, deadband: HsvDeadband): boolean {
    const ra = roundHsvForProtocol(a.h, a.s, a.v);
    const rb = roundHsvForProtocol(b.h, b.s, b.v);
    return (
        hueDistanceShortest(ra.h, rb.h) <= deadband.h &&
        Math.abs(ra.s - rb.s) <= deadband.s &&
        Math.abs(ra.v - rb.v) <= deadband.v
    );
}

export function computeChaseStep(
    lastSent: HsvColor,
    desired: HsvColor,
    lerpFrames: number,
    deadband: HsvDeadband,
): ChaseStepResult {
    if (hsvWithinDeadband(lastSent, desired, deadband)) {
        return {
            colorToSend: roundHsvForProtocol(desired.h, desired.s, desired.v),
            arrived: true,
            continueChase: false,
        };
    }

    const step = lerpFrames <= 1 ? desired : lerpHsv(lastSent, desired, 1 / lerpFrames);

    if (hsvWithinDeadband(lastSent, step, deadband) && hsvWithinDeadband(lastSent, desired, deadband)) {
        return { colorToSend: null, arrived: true, continueChase: false };
    }

    if (hsvWithinDeadband(lastSent, step, deadband)) {
        return { colorToSend: null, arrived: false, continueChase: true };
    }

    if (hsvWithinDeadband(step, desired, deadband)) {
        return {
            colorToSend: roundHsvForProtocol(desired.h, desired.s, desired.v),
            arrived: true,
            continueChase: false,
        };
    }

    return { colorToSend: step, arrived: false, continueChase: true };
}
