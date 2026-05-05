import { ControllerIntent } from '../ProjectManager';
import { Color } from '../color';

export class LightIntent {
  static transformToNormalized(intent: ControllerIntent): ControllerIntent {
    if (!intent.params || intent.params['color'] === undefined) return intent;
    return { ...intent, params: { ...intent.params, color: Color.createFromObject(intent.params['color']).toXYY(4) } };
  }
}
