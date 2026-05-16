import type { BindingManager } from '../BindingManager';
import type { IntentAccessFn, MutateIntentFn, KeyframeAnimatorCallbacks } from './keyframeAnimator';
import { KeyframeAnimator } from './keyframeAnimator';

/**
 * Every animator class that AnimationManager can instantiate must satisfy this interface.
 * Add a new animator: create a class implementing AnimatorPlugin, then register it below.
 */
export interface AnimatorPlugin {
  start(intentAccess: IntentAccessFn, mutateIntent: MutateIntentFn): void;
  setTimescale(factor: number): void;
  setRunMode(mode: string): void;
  executeCommand(args: Record<string, unknown>): void;
  cancel(reason: string): void;
  stripTimers(): void;
  onSceneMembershipChanged(inScene: boolean): void;
  enterEditMode(deps: {
    intentAccess: IntentAccessFn;
    mutateIntent: MutateIntentFn;
    bindingManager: BindingManager;
    commitEditIntentBaseline: (targetGuid: string) => void;
    getEditIntentDeltaPatch: (targetGuid: string) => Record<string, unknown>;
  }): void;
  exitEditMode(): void;
  reconcileStoredStepsAfterGraphMutation(): boolean;
}

export type AnimatorConstructor = new (
  animationGuid: string,
  callbacks: KeyframeAnimatorCallbacks,
) => AnimatorPlugin;

/**
 * Register every animator `class` string that the hub can instantiate at runtime.
 * Extension: add a module implementing {@link AnimatorPlugin}, then map its `class` here —
 * do not branch on animation class names in {@link AnimationManager}.
 */
const ANIMATOR_REGISTRY: Record<string, AnimatorConstructor> = {
  keyframeAnimator: KeyframeAnimator as AnimatorConstructor,
};

export function getAnimatorClass(name: string): AnimatorConstructor | undefined {
  return ANIMATOR_REGISTRY[name];
}
