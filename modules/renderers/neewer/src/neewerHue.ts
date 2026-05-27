/** Perceptual yellow on a correct HSV wheel (degrees). */
const YELLOW_PERCEPTUAL = 60;
/** Hue value the Neewer firmware needs to show that yellow. */
const YELLOW_DEVICE = 48;
/** Half-width of the correction bump (degrees, circular distance). */
const BEND_WIDTH_DEG = 40;

const HUE_DELTA = YELLOW_DEVICE - YELLOW_PERCEPTUAL;

const hueMaps = new Map<string, (h: number) => number>([
    ['neewerHue', mapNeewerHue],
]);

/** Shortest arc distance between two hues on [0, 360). */
export function hueDistanceDeg (a: number, b: number): number {
    const na = normalizeHue(a);
    const nb = normalizeHue(b);
    const d = Math.abs(na - nb);
    return d > 180 ? 360 - d : d;
}

export function normalizeHue (h: number): number {
    const n = h % 360;
    return n < 0 ? n + 360 : n;
}

/**
 * Map perceptual hue (from rgbToHsv01) to Neewer protocol hue.
 * Bends around yellow: perceptual 60° → device 48°; identity elsewhere.
 */
export function mapNeewerHue (h: number): number {
    const hue = normalizeHue(h);
    const dist = hueDistanceDeg(hue, YELLOW_PERCEPTUAL);
    if (dist >= BEND_WIDTH_DEG) return hue;

    const t = dist / BEND_WIDTH_DEG;
    const weight = Math.pow(Math.cos((t * Math.PI) / 2), 2);
    return normalizeHue(hue + HUE_DELTA * weight);
}

export function evaluateNeewerHue (name: unknown, h: number): number {
    if (typeof name !== 'string' || name.length === 0) return h;
    const fn = hueMaps.get(name);
    return fn ? fn(h) : h;
}
