export type BlendMode = 'ADD' | 'ALPHA' | 'MULTIPLY';

export class Color {
    constructor(
        public readonly x: number,
        public readonly y: number,
        public readonly Y: number
    ) {}

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
                const Y_out = this.Y * other.Y;
                const x_out = (this.x + other.x) / 2;
                const y_out = (this.y + other.y) / 2;
                return new Color(x_out, y_out, Y_out);
            }
        }
    }

    static black(): Color { return new Color(0.3127, 0.3290, 0); }
}
