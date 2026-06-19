import type { PhysicsBody } from '../PhysicsBody';
import { vec3 } from '../vec3';
import { ConnectorBase } from './ConnectorBase';

/** Fixed sub-step dt used by the engine. */
const DT = 0.05;
/** Relaxation passes per sub-step (mirrors `PhysicsConfig.iterations`, default 8). */
const ITERATIONS = 8;

/**
 * Internal connector used only while dragging. A is a fixed anchor (pinned) and B is the intent being
 * dragged. Instead of a force, B's position is **lerped** toward A by a mass-scaled fraction each
 * relaxation pass, clamped to at most the remaining error so it **never overshoots** regardless of
 * mass or iteration count. The engine's rigid pass re-derives velocity from the net position change,
 * carrying the impulse into connected partners.
 */
export class DragConnector extends ConnectorBase {
  project(a: PhysicsBody, b: PhysicsBody): void {
    if (b.pinned || b.mass <= 0) return;
    const stiffness = this.record.params['stiffness'] ?? 80;
    const maxForce = this.record.params['maxForce'] ?? 120;

    const error = vec3.sub(a.position, b.position);
    const mag = vec3.length(error);
    if (mag < 1e-9) return;

    // Per-iteration lerp fraction: stiffness × dt / iterations, clamped to [0, maxPull] (never > 1
    // per pass, so the body only moves toward the anchor and can never oscillate).
    const basePull = (stiffness * DT) / ITERATIONS;
    const maxPull = Math.min(1, (maxForce / b.mass) * DT / ITERATIONS);
    const factor = Math.min(basePull, maxPull);
    b.position = vec3.add(b.position, vec3.scale(error, factor));
  }

  // No force — the projection above handles everything.
  applyForce(_a: PhysicsBody, _b: PhysicsBody, _dt: number): void {}
}

ConnectorBase.registerKind('drag', DragConnector);
