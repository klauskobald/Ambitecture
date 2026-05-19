import type { PulseSetup } from '../ProjectManager';

const MIN_SPEED = 0.25;
const MAX_SPEED = 4;

export function clampPulseSetupSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, value));
}

export function resolvePulseSetupSpeed(setup: PulseSetup | undefined): number {
  const s = setup?.speed;
  if (typeof s !== 'number' || !Number.isFinite(s)) return 1;
  return clampPulseSetupSpeed(s);
}
