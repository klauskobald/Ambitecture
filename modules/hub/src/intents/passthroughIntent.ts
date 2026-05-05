import { ControllerIntent } from '../ProjectManager';

/** Identity transform for unknown intent classes until a dedicated handler exists. */
export class PassthroughIntent {
  static transformToNormalized(intent: ControllerIntent): ControllerIntent {
    return intent;
  }
}
