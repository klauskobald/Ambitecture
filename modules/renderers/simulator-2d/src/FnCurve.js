class FnCurve {
    static evaluate(name, x) {
        const fnName = typeof name === 'string' ? name : 'quadratic';
        const fn = FnCurve._functions[fnName] || FnCurve._functions.quadratic;
        const clampedX = Math.max(0, Math.min(1, x));
        const y = fn(clampedX);
        return Math.max(0, Math.min(1, y));
    }
}

FnCurve._functions = {
    linear: x => x,
    quadratic: x => Math.pow(x, 2),
    cubic: x => Math.pow(x, 3),
    sqrt: x => Math.sqrt(x),
    smoothstep: x => x * x * (3 - 2 * x),
};

