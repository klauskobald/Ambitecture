import { ControllerIntent } from '../ProjectManager';

/**
 * Effective `perform.reset.scene` — whether `runtimeMergeClear: scene` evicts merge cache for this intent.
 * Default: master → false (persist perform); otherwise true (including light).
 */
export function effectivePerformResetScene(intent: ControllerIntent | undefined): boolean {
  if (!intent) return true;
  const raw = intent.perform?.reset?.scene;
  if (typeof raw === 'boolean') {
    return raw;
  }
  if (intent.class === 'master') {
    return false;
  }
  return true;
}

export function intentToEvent(intent: ControllerIntent, scheduledAt: number): object {
  return {
    guid: intent.guid,
    layer: intent.layer,
    name: intent.name,
    class: intent.class,
    scheduled: scheduledAt,
    position: intent.position,
    radius: intent.radius,
    radiusFunction: intent.radiusFunction,
    params: intent.params,
  };
}

/** Marks an intent as logically absent from the renderer (e.g. scene switch). Not a light alpha tweak. */
export function intentRemovalEvent(intent: ControllerIntent, scheduledAt: number): object {
  return {
    guid: intent.guid,
    class: intent.class,
    scheduled: scheduledAt,
    removed: true,
  };
}
