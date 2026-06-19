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

function runChunks(engine: PhysicsEngine, totalMs: number, frameMs: number): void {
  let elapsed = 0;
  while (elapsed < totalMs) {
    engine.advance(frameMs);
    elapsed += frameMs;
  }
}

function pos(engine: PhysicsEngine, id: string): Vec3 {
  return engine.getBody(id)!.position;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function main(): void {
  // A. same sim rate, different wall chunking → identical
  const bigEngine = build(1, 0.3); runChunks(bigEngine, 6000, 100);
  const tinyEngine = build(1, 0.3); runChunks(tinyEngine, 6000, 5);
  const drift = vec3.distance(pos(bigEngine, 'a'), pos(tinyEngine, 'a'));
  console.log(`[A] frame-chunk drift=${drift.toFixed(5)}m (a→${pos(bigEngine, 'a').map(n => n.toFixed(2))})`);
  assert(drift < 0.02, `frame-rate dependent: drift ${drift.toFixed(4)}m`);

  // B. heavier A moves less than light B (COM stays mass-weighted)
  const heavyEngine = build(9, 0.3); runChunks(heavyEngine, 6000, 50);
  const moveA = Math.abs(pos(heavyEngine, 'a')[0] - 0);
  const moveB = Math.abs(pos(heavyEngine, 'b')[0] - 4);
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

  // D. drag link: a fixed anchor pulls a free intent to it without overshoot; the anchor never moves.
  const drag = new PhysicsEngine({ fps: 20, sleepVelocity: 0.005, iterations: 8 });
  const anchor: PhysicsBody = { id: 'anchor', position: [3, 0, 0], velocity: vec3.zero(), prevPosition: [3, 0, 0], mass: 1, drag: 0, pinned: true };
  const intent = makeBody('intent', [0, 0, 0], 1, 0);
  drag.setBody(anchor);
  drag.setBody(intent);
  drag.setConnectors([{ guid: 's', kind: 'drag', aId: 'anchor', bId: 'intent', restLength: 0, params: { stiffness: 80, maxForce: 120 } }]);
  let maxX = 0;
  for (let i = 0; i < 120; i++) { drag.advance(50); maxX = Math.max(maxX, drag.getBody('intent')!.position[0]); }
  const reached = vec3.distance(drag.getBody('intent')!.position, [3, 0, 0]);
  const anchorMoved = vec3.distance(drag.getBody('anchor')!.position, [3, 0, 0]);
  const overshoot = Math.max(0, maxX - 3);
  console.log(`[D] drag: reached dist=${reached.toFixed(3)} overshoot=${overshoot.toFixed(3)} anchorMoved=${anchorMoved.toFixed(3)}`);
  assert(reached < 0.05, 'intent should be pulled onto the anchor');
  assert(overshoot < 0.05, `critically-damped drag should not overshoot (was ${overshoot.toFixed(3)})`);
  assert(anchorMoved < 1e-9, 'fixed anchor must not move');

  console.log('[physics-test] PASS');
}

main();
