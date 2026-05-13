import type { AnimationManager } from '../../animation/AnimationManager';
import { isActiveTriggerValue } from './merge';

/**
 * After a scene action activates its scene, optional side effects from the merged trigger bag:
 * `execute.params.animationGuid` + trigger `value` → start or stop that animation.
 */
export function applySceneTriggerSideEffects(
  merged: Record<string, unknown>,
  animationManager: AnimationManager | undefined,
  location?: [number, number],
): void {
  const animGuid =
    typeof merged['animationGuid'] === 'string' && merged['animationGuid'].length > 0
      ? merged['animationGuid']
      : undefined;
  if (!animGuid || !animationManager || !Object.prototype.hasOwnProperty.call(merged, 'value')) {
    return;
  }
  const loc = location;
  const stopLikeOpts = loc !== undefined ? { location: loc } : undefined;
  if (isActiveTriggerValue(merged['value'])) {
    const opts: { location?: [number, number]; timescale?: number } = {};
    if (loc !== undefined) {
      opts.location = loc;
    }
    animationManager.trigger(animGuid, opts);
  } else {
    animationManager.stop(animGuid, stopLikeOpts);
  }
}
