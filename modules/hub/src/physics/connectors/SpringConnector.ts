import type { PhysicsBody } from '../PhysicsBody';
import { ConnectorBase } from './ConnectorBase';

/** Maps `springForce` (0.1 loose … 0.9 fixed) to a Hooke stiffness; kept low enough for semi-implicit Euler stability. */
const STIFFNESS_SCALE = 40;

/**
 * Soft link: a Hooke spring, `F = k·(dist − restLength)` along the axis, applied as a force so the
 * bodies accelerate, overshoot and oscillate (momentum) instead of snapping. Damping comes from each
 * body's `drag`, not the spring — so `drag: 0` rings indefinitely, by design.
 */
export class SpringConnector extends ConnectorBase {
  applyForce(a: PhysicsBody, b: PhysicsBody, dt: number): void {
    const springForce = this.record.params['springForce'] ?? 0.5;
    const k = springForce * STIFFNESS_SCALE;
    const { dir, dist } = this.direction(a, b);
    const force = k * (dist - this.restLength);
    this.applyAxialImpulse(a, b, dir, force, dt);
  }
}

ConnectorBase.registerKind('spring', SpringConnector);
