import { ProjectManager } from '../ProjectManager';
import { configResolver } from '../ConfigResolver';

const DEFAULT_MAX_FOLLOW_TIME = 2;

/**
 * Largest per-fixture `params.maxFollowTime` (seconds) in the project — drives the upper bound of the
 * `target` intent's speed (follow-time) slider so the UI max tracks the rig instead of duplicating it.
 */
export function registerMaxFollowTimeResolver(pm: ProjectManager): void {
  configResolver.register('maxFollowTime', () => {
    let max = 0;
    for (const zone of pm.getSerializedRuntimeZones()) {
      const fixtures = (zone as { fixtures?: unknown[] })?.fixtures;
      if (!Array.isArray(fixtures)) continue;
      for (const fixture of fixtures) {
        const params = (fixture as { params?: Record<string, unknown> })?.params;
        const v = params?.['maxFollowTime'];
        if (typeof v === 'number' && Number.isFinite(v) && v > max) max = v;
      }
    }
    return max > 0 ? max : DEFAULT_MAX_FOLLOW_TIME;
  });
}
