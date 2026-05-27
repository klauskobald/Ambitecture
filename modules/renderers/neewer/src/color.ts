export type BlendMode = 'ADD' | 'ALPHA' | 'MULTIPLY';

export class Color {
    constructor(
        public readonly x: number,
        public readonly y: number,
        public readonly Y: number
    ) { }

    toLinearRGB(): { r: number; g: number; b: number } {
        const { x, y, Y } = this;
        if (y === 0) return { r: 0, g: 0, b: 0 };

        const X = (Y / y) * x;
        const Z = (Y / y) * (1 - x - y);

        return {
            r: Math.max(0, 3.2406 * X - 1.5372 * Y - 0.4986 * Z),
            g: Math.max(0, -0.9689 * X + 1.8758 * Y + 0.0415 * Z),
            b: Math.max(0, 0.0557 * X - 0.2040 * Y + 1.0570 * Z),
        };
    }

    static fromLinearRGB(r: number, g: number, b: number): Color {
        const rLin = Math.max(0, r);
        const gLin = Math.max(0, g);
        const bLin = Math.max(0, b);
        const X = 0.4124564 * rLin + 0.3575761 * gLin + 0.1804375 * bLin;
        const Y = 0.2126729 * rLin + 0.7151522 * gLin + 0.0721750 * bLin;
        const Z = 0.0193339 * rLin + 0.1191920 * gLin + 0.9503041 * bLin;
        const sum = X + Y + Z;
        const x = sum > 0 ? X / sum : 0.3127;
        const y = sum > 0 ? Y / sum : 0.3290;
        return new Color(x, y, Math.max(0, Math.min(1, Y)));
    }

    blend(other: Color, mode: BlendMode, alpha: number): Color {
        switch (mode) {
            case 'ADD': {
                const Y_out = Math.min(this.Y + other.Y * alpha, 1.0);
                const denom = this.Y + other.Y * alpha;
                const x_out = denom > 0 ? (this.x * this.Y + other.x * other.Y * alpha) / denom : this.x;
                const y_out = denom > 0 ? (this.y * this.Y + other.y * other.Y * alpha) / denom : this.y;
                return new Color(x_out, y_out, Y_out);
            }
            case 'ALPHA': {
                const Y_out = other.Y * alpha + this.Y * (1 - alpha);
                const denom = Y_out;
                const x_out = denom > 0 ? (other.x * other.Y * alpha + this.x * this.Y * (1 - alpha)) / denom : this.x;
                const y_out = denom > 0 ? (other.y * other.Y * alpha + this.y * this.Y * (1 - alpha)) / denom : this.y;
                return new Color(x_out, y_out, Y_out);
            }
            case 'MULTIPLY': {
                // lerp identity (this) ↔ multiplied result by alpha,
                // so callers can attenuate MULTIPLY via spatial factor / user alpha
                const Y_mul = this.Y * other.Y;
                const Y_out = Y_mul * alpha + this.Y * (1 - alpha);
                const x_mix = (this.x + other.x) / 2;
                const y_mix = (this.y + other.y) / 2;
                const x_out = this.x * (1 - alpha) + x_mix * alpha;
                const y_out = this.y * (1 - alpha) + y_mix * alpha;
                return new Color(x_out, y_out, Y_out);
            }
        }
    }

    toRGB(): { r: number; g: number; b: number } {
        const { r: rLin, g: gLin, b: bLin } = this.toLinearRGB();

        const gamma = (v: number): number => {
            const c = Math.max(0, Math.min(1, v));
            return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
        };

        return {
            r: (gamma(rLin)),
            g: (gamma(gLin)),
            b: (gamma(bLin)),
        };
    }

    static black(): Color { return new Color(0.3127, 0.3290, 0); }
}

export interface HSV {
    h: number;
    s: number;
    v: number;
}

export function rgbToHsv01(r: number, g: number, b: number): HSV {
    const rc = Math.max(0, Math.min(1, r));
    const gc = Math.max(0, Math.min(1, g));
    const bc = Math.max(0, Math.min(1, b));
    const max = Math.max(rc, gc, bc);
    const min = Math.min(rc, gc, bc);
    const d = max - min;

    let h = 0;
    if (d > 0) {
        if (max === rc) h = ((gc - bc) / d) % 6;
        else if (max === gc) h = (bc - rc) / d + 2;
        else h = (rc - gc) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    const s = max > 0 ? (d / max) * 100 : 0;
    const v = max * 100;
    return { h, s, v };
}

