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

export function zeroAlphaEvent(intent: ControllerIntent, scheduledAt: number): object {
  return {
    ...intentToEvent(intent, scheduledAt),
    params: { ...intent.params, alpha: 0 },
  };
}
