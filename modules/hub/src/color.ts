export interface XYY {
  x: number;
  y: number;
  Y: number;
}

export class Color {
  private xyy: XYY;

  private constructor(xyy: XYY) {
    this.xyy = xyy;
  }

  static createFromObject(input: unknown): Color {
    if (!input || typeof input !== 'object') {
      throw new Error('Unrecognized color format');
    }

    const obj = input as Record<string, unknown>;

    if (isXYYObject(obj)) {
      return new Color({ x: obj.x, y: obj.y, Y: obj.Y });
    }

    if (isHexRGBObject(obj)) {
      return new Color(hexStringToXYY(obj.rgb));
    }

    if (isArrayRGBObject(obj)) {
      return new Color(rgbArrayToXYY(obj.rgb));
    }

    if (isComponentRGBObject(obj)) {
      return new Color(rgbComponentsToXYY(obj.r, obj.g, obj.b));
    }

    if (isHSLObject(obj)) {
      return new Color(hslToXYY(obj.h, obj.s, obj.l));
    }

    throw new Error('Unrecognized color format');
  }

  toXYY(precision?: number): XYY {
    if (precision === undefined) return { ...this.xyy };
    const r = (n: number) => parseFloat(n.toFixed(precision));
    return { x: r(this.xyy.x), y: r(this.xyy.y), Y: r(this.xyy.Y) };
  }
}

function isXYYObject(obj: Record<string, unknown>): obj is { x: number; y: number; Y: number } {
  return typeof obj['x'] === 'number' && typeof obj['y'] === 'number' && typeof obj['Y'] === 'number';
}

function isHexRGBObject(obj: Record<string, unknown>): obj is { rgb: string } {
  return typeof obj['rgb'] === 'string' && (obj['rgb'] as string).startsWith('#');
}

function isArrayRGBObject(obj: Record<string, unknown>): obj is { rgb: [number, number, number] } {
  return Array.isArray(obj['rgb']);
}

function isComponentRGBObject(obj: Record<string, unknown>): obj is { r: number; g: number; b: number } {
  return typeof obj['r'] === 'number' && typeof obj['g'] === 'number' && typeof obj['b'] === 'number';
}

function linearizeSRGBChannel(c: number): number {
  const normalized = c / 255;
  if (normalized <= 0.04045) {
    return normalized / 12.92;
  }
  return Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function rgbLinearToXYY(rLin: number, gLin: number, bLin: number): XYY {
  const X = 0.4124564 * rLin + 0.3575761 * gLin + 0.1804375 * bLin;
  const Y = 0.2126729 * rLin + 0.7151522 * gLin + 0.0721750 * bLin;
  const Z = 0.0193339 * rLin + 0.1191920 * gLin + 0.9503041 * bLin;

  const sum = X + Y + Z;
  const x = sum > 0 ? X / sum : 0.3127;
  const y = sum > 0 ? Y / sum : 0.3290;

  return { x, y, Y };
}

function hexStringToXYY(hex: string): XYY {
  const stripped = hex.replace('#', '');
  const r = parseInt(stripped.substring(0, 2), 16);
  const g = parseInt(stripped.substring(2, 4), 16);
  const b = parseInt(stripped.substring(4, 6), 16);

  return rgbLinearToXYY(
    linearizeSRGBChannel(r),
    linearizeSRGBChannel(g),
    linearizeSRGBChannel(b)
  );
}

function rgbArrayToXYY(rgb: [number, number, number]): XYY {
  return rgbLinearToXYY(
    linearizeSRGBChannel(rgb[0]),
    linearizeSRGBChannel(rgb[1]),
    linearizeSRGBChannel(rgb[2])
  );
}

function rgbComponentsToXYY(r: number, g: number, b: number): XYY {
  return rgbLinearToXYY(
    linearizeSRGBChannel(r),
    linearizeSRGBChannel(g),
    linearizeSRGBChannel(b)
  );
}

function isHSLObject(obj: Record<string, unknown>): obj is { h: number; s: number; l: number } {
  return typeof obj['h'] === 'number' && typeof obj['s'] === 'number' && typeof obj['l'] === 'number';
}

function hslToXYY(h: number, s: number, l: number): XYY {
  // Standard HSL → sRGB conversion
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  // Scale to 0-255 then linearize via existing path
  return rgbLinearToXYY(
    linearizeSRGBChannel((r + m) * 255),
    linearizeSRGBChannel((g + m) * 255),
    linearizeSRGBChannel((b + m) * 255)
  );
}
