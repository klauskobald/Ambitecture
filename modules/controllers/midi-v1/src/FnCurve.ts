/**
 * Canonical behaviour must stay aligned with hub + renderer implementations:
 *
 * @see ../../../hub/src/FnCurve.ts
 * @see ../../../renderers/dmx-ts/src/FnCurve.ts
 */
type CurveFn = (x: number) => number;

export class FnCurve {
  private static readonly functions = new Map<string, CurveFn>([
    ['linear', (x) => x],
    ['quadratic', (x) => Math.pow(x, 2)],
    ['cubic', (x) => Math.pow(x, 3)],
    ['sqrt', (x) => Math.sqrt(x)],
    ['smoothstep', (x) => x * x * (3 - 2 * x)],
    ['hard', (x) => (x > 0 ? 1 : 0)],
  ]);

  static evaluateClamped(name: any, x: number): number {
    const fn = this.functions.get(name) ?? this.functions.get('linear')!;
    const clampedX = Math.max(0, Math.min(1, x));
    const y = fn(clampedX);
    return Math.max(0, Math.min(1, y));
  }

  static evaluate(name: any, x: number): number {
    const fn = this.functions.get(name) ?? this.functions.get('linear')!;
    return fn(x);
  }
}
