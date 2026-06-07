import { ControllerIntent } from '../ProjectManager';

/**
 * A `target` (lookAt magnet) intent carries only geometry (`position` + influence) — its per-fixture
 * effect is resolved by the `targetResolver` under `resolve/FixtureStateManager`. No shaping needed.
 */
export class TargetIntent {
  static transformToNormalized(intent: ControllerIntent): ControllerIntent {
    return intent;
  }
}
