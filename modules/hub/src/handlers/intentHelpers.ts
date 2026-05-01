import { ControllerIntent } from '../ProjectManager';
import { Color } from '../color';

export function normalizeIntentColor(intent: ControllerIntent): ControllerIntent {
  if (!intent.params || intent.params['color'] === undefined) return intent;
  return { ...intent, params: { ...intent.params, color: Color.createFromObject(intent.params['color']).toXYY(4) } };
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

/** @deprecated Prefer intentRemovalEvent when the intent must disappear from engine state. */
export function zeroAlphaEvent(intent: ControllerIntent, scheduledAt: number): object {
  return {
    ...intentToEvent(intent, scheduledAt),
    params: { ...intent.params, alpha: 0 },
  };
}
