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

export function transformIntentToNormalized(intent: ControllerIntent): ControllerIntent {
  const handler = REGISTRY[intent.class] ?? PassthroughIntent;
  return handler.transformToNormalized(intent);
}
