class FnCurve {
    static evaluate(name, x) {
        const fnName = typeof name === 'string' ? name : 'quadratic';
        const fn = FnCurve._functions[fnName] || FnCurve._functions.quadratic;
        return fn(x);
    }
}

FnCurve._functions = {
    linear: x => x,
    quadratic: x => Math.pow(x, 2),
    cubic: x => Math.pow(x, 3),
    sqrt: x => Math.sqrt(x),
    smoothstep: x => x * x * (3 - 2 * x),
    // Full strength from center up to (but not including) the radius edge; 0 outside.
    hard: x => (x > 0 ? 1 : 0),
};

