class Color {
    constructor(x, y, Y) {
        this.x = x;
        this.y = y;
        this.Y = Y;
    }

    toRGB() {
        const { x, y, Y } = this;
        if (y === 0) return { r: 0, g: 0, b: 0 };

        const X = (Y / y) * x;
        const Z = (Y / y) * (1 - x - y);

        const rLin =  3.2406 * X - 1.5372 * Y - 0.4986 * Z;
        const gLin = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
        const bLin =  0.0557 * X - 0.2040 * Y + 1.0570 * Z;

        const gamma = v => {
            const c = Math.max(0, Math.min(1, v));
            return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
        };

        return { r: gamma(rLin), g: gamma(gLin), b: gamma(bLin) };
    }

    static fromXYY({ x, y, Y }) {
        return new Color(x, y, Y);
    }
}
