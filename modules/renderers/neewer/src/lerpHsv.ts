export interface HsvColor {
    h: number;
    s: number;
    v: number;
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
