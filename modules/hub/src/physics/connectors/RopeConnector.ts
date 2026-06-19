import type { PhysicsBody } from '../PhysicsBody';
import { ConnectorBase } from './ConnectorBase';

/**
 * Slack link: exerts no force while the bodies are closer than `restLength` (the rope's length), and
 * becomes rigid (rod-like) the moment they stretch past it.
 */
export class RopeConnector extends ConnectorBase {
  project(a: PhysicsBody, b: PhysicsBody): void {
    const { dir, dist } = this.direction(a, b);
    if (dist <= this.restLength) return;
    this.applySeparation(a, b, dir, this.restLength, 1);
  }
}

ConnectorBase.registerKind('rope', RopeConnector);
