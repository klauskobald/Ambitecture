import type { PhysicsBody } from '../PhysicsBody';
import { vec3 } from '../vec3';
import { ConnectorBase } from './ConnectorBase';

/**
 * Rigid link: distance is locked to `restLength`. `rotationSpring` (0..1) blends how strongly the bond
 * keeps its original world orientation — 0 lets it swing freely (distance-only), 1 holds the original
 * direction like a welded frame.
 */
export class RodConnector extends ConnectorBase {
  project(a: PhysicsBody, b: PhysicsBody): void {
    const rotationSpring = this.record.params['rotationSpring'] ?? 1;
    const { dir } = this.direction(a, b);
    const restDir = this.record.restDir;
    const targetDir = rotationSpring > 0 && restDir
      ? vec3.normalize(vec3.lerp(dir, restDir, rotationSpring))
      : dir;
    this.applySeparation(a, b, targetDir, this.restLength, 1);
  }
}

ConnectorBase.registerKind('rod', RodConnector);
