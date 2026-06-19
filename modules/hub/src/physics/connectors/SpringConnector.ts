import type { PhysicsBody } from '../PhysicsBody';
import { vec3 } from '../vec3';
import { ConnectorBase } from './ConnectorBase';

/** Maps `springForce` (0.1 loose … 0.9 fixed) to a Hooke stiffness; kept low enough for semi-implicit Euler stability. */
const STIFFNESS_SCALE = 40;

/**
 * Soft link: a Hooke spring, `F = k·(dist − restLength)` along the axis, applied as a force so the
 * bodies accelerate, overshoot and oscillate (momentum) instead of snapping. Damping normally comes
 * from each body's `drag` (so `drag: 0` rings indefinitely, by design); an optional `damping` param
 * adds spring-axis damping — used by the temporary drag spring for a controlled mouse-follow.
 */
export class SpringConnector extends ConnectorBase {
  applyForce(a: PhysicsBody, b: PhysicsBody, dt: number): void {
    const springForce = this.record.params['springForce'] ?? 0.5;
    const damping = this.record.params['damping'] ?? 0;
    const k = springForce * STIFFNESS_SCALE;
    const { dir, dist } = this.direction(a, b);
    let force = k * (dist - this.restLength);
    if (damping > 0) {
      force += damping * vec3.dot(vec3.sub(b.velocity, a.velocity), dir);
    }
    this.applyAxialImpulse(a, b, dir, force, dt);
  }
}

ConnectorBase.registerKind('spring', SpringConnector);
