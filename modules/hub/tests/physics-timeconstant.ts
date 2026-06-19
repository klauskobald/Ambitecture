/**
 * Standalone (no hub) checks for the physics solver. Run: ts-node tests/physics-timeconstant.ts
 *
 *  A. Frame-rate independence — for a fixed sim rate, advancing the same wall time in big vs tiny chunks
 *     must give the same result (the fixed-dt sub-step accumulator guarantees this).
 *  B. Mass matters — under one spring, the heavier body moves less than the lighter one.
 *  C. Drag matters — drag=0 keeps momentum (never settles); drag>0 bleeds it off and sleeps.
 */
import { PhysicsEngine } from '../src/physics/PhysicsEngine';
import type { PhysicsBody } from '../src/physics/PhysicsBody';
import { vec3, type Vec3 } from '../src/physics/vec3';

function makeBody(id: string, position: Vec3, mass = 1, drag = 0): PhysicsBody {
  return { id, position, velocity: vec3.zero(), prevPosition: vec3.clone(position), mass, drag, pinned: false };
}

function build(massA: number, drag: number): PhysicsEngine {
  const engine = new PhysicsEngine({ fps: 20, sleepVelocity: 0.005, iterations: 8 });
  engine.setBody(makeBody('a', [0, 0, 0], massA, drag));
  engine.setBody(makeBody('b', [4, 0, 0], 1, drag));
  engine.setConnectors([{ guid: 'c', kind: 'spring', aId: 'a', bId: 'b', restLength: 1, params: { springForce: 0.5 } }]);
  return engine;
}

function runChunks(engine: PhysicsEngine, totalMs: number, frameMs: number): { a: Vec3; b: Vec3 } {
  let elapsed = 0;
  while (elapsed < totalMs) {
    engine.advance(frameMs);
    elapsed += frameMs;
  }
  return { a: engine.getBody('a')!.position, b: engine.getBody('b')!.position };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function main(): void {
  // A. same sim rate, different wall chunking → identical
  const big = runChunks(build(1, 0.3), 6000, 100);
  const tiny = runChunks(build(1, 0.3), 6000, 5);
  const drift = vec3.distance(big.a, tiny.a);
  console.log(`[A] frame-chunk drift=${drift.toFixed(5)}m (a→${big.a.map(n => n.toFixed(2))})`);
  assert(drift < 0.02, `frame-rate dependent: drift ${drift.toFixed(4)}m`);

  // B. heavier A moves less than light B (COM stays mass-weighted)
  const heavy = runChunks(build(9, 0.3), 6000, 50);
  const moveA = Math.abs(heavy.a[0] - 0);
  const moveB = Math.abs(heavy.b[0] - 4);
  console.log(`[B] mass: |Δa|=${moveA.toFixed(2)} (m=9) vs |Δb|=${moveB.toFixed(2)} (m=1)`);
  assert(moveB > moveA * 2, `mass ignored: a moved ${moveA.toFixed(2)}, b moved ${moveB.toFixed(2)}`);

  // C. drag=0 keeps moving (not settled); drag>0 settles
  const noDrag = build(1, 0);
  runChunks(noDrag, 4000, 50);
  const speedNoDrag = vec3.length(noDrag.getBody('a')!.velocity);
  const withDrag = build(1, 0.6);
  runChunks(withDrag, 10000, 50);
  const speedDrag = vec3.length(withDrag.getBody('a')!.velocity);
  console.log(`[C] drag: speed@drag0=${speedNoDrag.toFixed(3)} speed@drag0.6=${speedDrag.toFixed(4)}`);
  assert(speedNoDrag > 0.05, 'drag=0 should keep momentum');
  assert(speedDrag < speedNoDrag * 0.05, 'drag>0 should bleed off momentum');

  console.log('[physics-test] PASS');
}

main();
