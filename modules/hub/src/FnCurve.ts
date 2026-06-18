/**
 * Canonical behaviour must stay aligned with renderer implementation:
 *
 * @see ../../renderers/dmx-ts/src/FnCurve.ts — update both when curve math changes.
 */
type CurveFn = (x: number) => number;

export class FnCurve {
  private static readonly functions = new Map<string, CurveFn>([
    ['linear', (x) => x],
    ['quadratic', (x) => Math.pow(x, 2)],
    ['cubic', (x) => Math.pow(x, 3)],
    ['sqrt', (x) => Math.sqrt(x)],
    ['smoothstep', (x) => x * x * (3 - 2 * x)],
    // Full strength inside the radius/range, instant cutoff at the edge.
    ['hard', (x) => (x > 0 ? 1 : 0)],
  ]);

  static evaluate(name: any, x: number): number {
    const fn = this.functions.get(name) ?? this.functions.get('linear')!;
    return fn(x);
  }
}
