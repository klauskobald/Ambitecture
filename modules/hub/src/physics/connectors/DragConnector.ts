import type { PhysicsBody } from '../PhysicsBody';
import { inverseMass } from '../PhysicsBody';
import { vec3 } from '../vec3';
import { ConnectorBase } from './ConnectorBase';

/**
 * Internal connector used only while dragging: a **critically-damped** point follow from the fixed
 * anchor A (cursor/animation target) to the dragged intent B. Two properties make it stable where a raw
 * spring is not:
 *  - critical damping (`c = 2·√(k·m)`) removes the springy overshoot/oscillation;
 *  - the force magnitude is **clamped** to `maxForce`, so a fast or far cursor move cannot inject a huge
 *    impulse that propagates violently down the connection chain — B accelerates toward the anchor at a
 *    bounded rate and the rest of the network feels a bounded pull.
 * A is fixed (pinned), so only B receives the force.
 */
export class DragConnector extends ConnectorBase {
  applyForce(a: PhysicsBody, b: PhysicsBody, dt: number): void {
    const wB = inverseMass(b);
    if (wB === 0) return;
    const k = this.record.params['stiffness'] ?? 80;
    const maxForce = this.record.params['maxForce'] ?? 120;
    const c = 2 * Math.sqrt(k * b.mass);

    const disp = vec3.sub(b.position, a.position);
    let force = vec3.sub(vec3.scale(disp, -k), vec3.scale(b.velocity, c));
    const mag = vec3.length(force);
    if (mag > maxForce) force = vec3.scale(force, maxForce / mag);

    b.velocity = vec3.add(b.velocity, vec3.scale(force, wB * dt));
  }
}

ConnectorBase.registerKind('drag', DragConnector);
