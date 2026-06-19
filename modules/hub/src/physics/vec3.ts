export type Vec3 = [number, number, number];

const EPSILON = 1e-9;

export const vec3 = {
  zero(): Vec3 {
    return [0, 0, 0];
  },

  clone(a: Vec3): Vec3 {
    return [a[0], a[1], a[2]];
  },

  add(a: Vec3, b: Vec3): Vec3 {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  },

  sub(a: Vec3, b: Vec3): Vec3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  },

  scale(a: Vec3, s: number): Vec3 {
    return [a[0] * s, a[1] * s, a[2] * s];
  },

  length(a: Vec3): number {
    return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  },

  dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  },

  distance(a: Vec3, b: Vec3): number {
    return vec3.length(vec3.sub(a, b));
  },

  /** Unit vector; returns zero for a near-zero input so callers never divide by zero. */
  normalize(a: Vec3): Vec3 {
    const len = vec3.length(a);
    if (len < EPSILON) return [0, 0, 0];
    return [a[0] / len, a[1] / len, a[2] / len];
  },

  lerp(a: Vec3, b: Vec3, t: number): Vec3 {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  },
};
