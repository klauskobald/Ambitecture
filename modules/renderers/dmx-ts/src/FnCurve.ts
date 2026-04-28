type CurveFn = (x: number) => number;

export class FnCurve {
    private static readonly functions = new Map<string, CurveFn>([
        ['linear', (x) => x],
        ['quadratic', (x) => Math.pow(x, 2)],
        ['cubic', (x) => Math.pow(x, 3)],
        ['sqrt', (x) => Math.sqrt(x)],
        ['smoothstep', (x) => x * x * (3 - 2 * x)],
    ]);

    static evaluate(name: unknown, x: number): number {
        const fnName = typeof name === 'string' ? name : 'quadratic';
        const fn = this.functions.get(fnName) ?? this.functions.get('quadratic')!;
        const clampedX = Math.max(0, Math.min(1, x));
        const y = fn(clampedX);
        return Math.max(0, Math.min(1, y));
    }
}

