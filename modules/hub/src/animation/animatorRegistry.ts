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
  /** Freeze at the current position (clear timers, keep runner alive). Paired with {@link resume}. */
  pause(): void;
  /** Continue from the frozen position without a time jump. No-op if not paused. */
  resume(): void;
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
  /** Whether this runner is actively playing and should be included in snapshot capture. */
  isCapturableForSnapshot(): boolean;
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

/**
 * Collect {@code static uiDescriptor} from every registered animator class.
 * Used by {@link RegisterHandler} to merge into {@code systemCapabilities.animations[]}
 * without hardcoding class names.
 */
export function getAllAnimatorDescriptors(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [cls, Ctor] of Object.entries(ANIMATOR_REGISTRY)) {
    const staticDesc = (Ctor as unknown as { uiDescriptor?: Record<string, unknown> }).uiDescriptor;
    if (staticDesc && typeof staticDesc === 'object' && !Array.isArray(staticDesc)) {
      out[cls] = staticDesc as Record<string, unknown>;
    }
  }
  return out;
}

/**
 * Collect {@code static commandDescriptors()} from every registered animator class.
 * Used by {@link RegisterHandler} to merge into {@code systemCapabilities.animations[].commands}
 * without hardcoding class names.
 */
export function getAllAnimatorCommandDescriptors(): Record<string, { command: string; hint: string; params: Record<string, unknown> }[]> {
  const out: Record<string, { command: string; hint: string; params: Record<string, unknown> }[]> = {};
  for (const [cls, Ctor] of Object.entries(ANIMATOR_REGISTRY)) {
    const staticFn = (Ctor as unknown as { commandDescriptors?: () => { command: string; hint: string; params: Record<string, unknown> }[] }).commandDescriptors;
    if (typeof staticFn === 'function') {
      const result = staticFn();
      if (Array.isArray(result)) {
        out[cls] = result;
      }
    }
  }
  return out;
}
