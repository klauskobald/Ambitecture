import type { Vec3 } from './vec3';

/**
 * A single point mass tracked by the solver. `pinned` bodies are externally driven (e.g. an operator
 * dragging the intent): the integrator skips them and constraints treat them as immovable, so the rest
 * of the network resolves around them.
 */
export interface PhysicsBody {
  id: string;
  position: Vec3;
  velocity: Vec3;
  mass: number;
  drag: number;
  pinned: boolean;
  /** Set by the integrator before constraint solving so velocity can be re-derived from the net move. */
  prevPosition: Vec3;
}

/**
 * Inverse mass — how a constraint correction is split between two bodies. Heavier bodies move less;
 * pinned bodies are immovable (0). Drag is *not* here — it damps velocity in the integrator.
 */
export function inverseMass(body: PhysicsBody): number {
  if (body.pinned || body.mass <= 0) return 0;
  return 1 / body.mass;
}
