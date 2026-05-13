import { ControllerIntent } from '../ProjectManager';
import { LightIntent } from './lightIntent';
import { MasterIntent } from './masterIntent';
import { PassthroughIntent } from './passthroughIntent';

type IntentTransformClass = {
  transformToNormalized(intent: ControllerIntent): ControllerIntent;
};

/**
 * Register every hub-side intent `class` string that needs non-default shaping.
 * Extension: add a module in this folder with static `transformToNormalized`, then map
 * `class` here — do not branch on `intent.class` at renderer event call sites.
 */
const REGISTRY: Record<string, IntentTransformClass> = {
  light: LightIntent,
  master: MasterIntent,
};

/**
 * Validates and normalizes intent position. If position is invalid (not an array with 3 numbers),
 * it is reset to [0, 0, 0]. This handles cases where intents are saved with invalid position data.
 */
export function validateAndFixIntentPosition(intent: ControllerIntent): ControllerIntent {
  if (!intent.position || !Array.isArray(intent.position) || intent.position.length !== 3) {
    return { ...intent, position: [0, 0, 0] };
  }
  const numericPosition = [
    Number(intent.position[0]),
    Number(intent.position[1]),
    Number(intent.position[2]),
  ];
  if (numericPosition.some(n => isNaN(n))) {
    return { ...intent, position: [0, 0, 0] };
  }
  if (numericPosition[0] !== intent.position[0] || numericPosition[1] !== intent.position[1] || numericPosition[2] !== intent.position[2]) {
    return { ...intent, position: numericPosition as [number, number, number] };
  }
  return intent;
}

export function transformIntentToNormalized(intent: ControllerIntent): ControllerIntent {
  const handler = REGISTRY[intent.class] ?? PassthroughIntent;
  return handler.transformToNormalized(intent);
}
