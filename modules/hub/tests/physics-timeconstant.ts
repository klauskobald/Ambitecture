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
  const engine = new PhysicsEngine({ fps: 20, sleepVelocity: 0.005, iterations: 8, watchIntervalMs: 9999 });
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

  // D. drag link: a fixed anchor pulls a free intent — never overshoots, even at low mass.
  const testDrag = (label: string, mass: number) => {
    const eng = new PhysicsEngine({ fps: 20, sleepVelocity: 0.005, iterations: 8, watchIntervalMs: 9999 });
    const anc: PhysicsBody = { id: 'anc', position: [3, 0, 0], velocity: vec3.zero(), prevPosition: [3, 0, 0], mass: 1, drag: 0, pinned: true };
    const i = makeBody('i', [0, 0, 0], mass, 0);
    eng.setBody(anc);
    eng.setBody(i);
    eng.setConnectors([{ guid: 's', kind: 'drag', aId: 'anc', bId: 'i', restLength: 0, params: { stiffness: 100, maxForce: 1500 } }]);
    let maxX = 0;
    for (let s = 0; s < 120; s++) { eng.advance(50); maxX = Math.max(maxX, eng.getBody('i')!.position[0]); }
    const dist = vec3.distance(eng.getBody('i')!.position, [3, 0, 0]);
    const over = Math.max(0, maxX - 3);
    console.log(`[D] drag ${label}: mass=${mass} reached=${dist.toFixed(3)} overshoot=${over.toFixed(4)}`);
    assert(dist < 0.05, `${label}: should reach anchor`);
    assert(over < 0.02, `${label}: overshoot ${over.toFixed(4)} > 0.02`);
  };
  testDrag('light', 0.2);
  testDrag('heavy', 10);

  console.log('[physics-test] PASS');
}

main();
