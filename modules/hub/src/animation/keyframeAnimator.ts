import type { ControllerIntent } from '../ProjectManager';
import type { AnimationRunStatus } from '../hubStatusTypes';
import type { BindingManager } from '../BindingManager';
import { Logger } from '../Logger';
import { applyDotPathPatch, cloneRecord, readAtDotPath, setAtDotPath } from '../dotPath';

import {
  MAX_LERP_SUBSTEPS_PER_SEGMENT,
  effectiveLerpQuantization,
  planIntermediateLerpPatches,
  type PlanIntermediateLerpOptions,
} from './paramLerpSchedule';
import { resolveAnimationTargetIntents } from './resolveAnimationTargetIntents';

export type IntentAccessFn = (guid: string) => ControllerIntent | undefined;
/** Dot-path patch only — merged on hub merge cache (preserves unrelated fields e.g. live knob edits). */
export type MutateIntentFn = (guid: string, patch: Record<string, unknown>) => void;

export type AnimatorFieldDescriptor = {
  name: string;
  hint?: string;
  /** Data type of the field value. Widget type is declared in systemCapabilities.animations[].display. */
  type: 'number' | 'string';
  step?: number;
  default?: number | string;
  range?: [number, number];
  /** Key into top-level systemCapabilities for a string[] options list (e.g. 'functionCurves'). */
  optionsRef?: string;
  /** Named curve function applied to the slider t value (e.g. 'quadratic'). Passed to fnCurve on the controller. */
  stepFunction?: string;
};

export interface KeyframeAnimatorCallbacks {
  onStatus: (payload: {
    status: AnimationRunStatus;
    message: { text: string };
    data: Record<string, unknown>;
  }) => void;
  onDefinitionChanged?: () => void;
  /**
   * Live row from {@link ProjectManager.getAnimationByGuid} — never cache on the animator.
   * Graph upserts replace `animations[]` with cloned rows; a stale reference would persist edits to a detached object.
   */
  getDefinitionRecord: () => Record<string, unknown> | undefined;
}

/** Deep-clone one subtree read from the intent so lerp planning never mutates the live object. */
function cloneSubtreeForLerp(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

/**
 * Copies only dot paths listed in `argKeys` from the base intent.
 * {@link planIntermediateLerpPatches} / {@link diffNumericLeaves} only need numeric leaves on paths
 * touched by the adjacent keyframes — cloning the entire intent for every lerp segment was unnecessary work.
 */
function sliceIntentAtArgKeys(base: Record<string, unknown>, argKeys: readonly string[]): Record<string, unknown> {
  const slice: Record<string, unknown> = {};
  for (const dotKey of argKeys) {
    const v = readAtDotPath(base, dotKey);
    if (v === undefined) continue;
    setAtDotPath(slice, dotKey, cloneSubtreeForLerp(v));
  }
  return slice;
}

/**
 * Minimal “from” / “to” roots for {@link planIntermediateLerpPatches}: same numeric diffs as patching
 * full `base` but only under the union of keys in prev/next step args.
 */
function lerpPlanEndpoints(
  baseRecord: Record<string, unknown>,
  prevArgs: Record<string, unknown> | undefined,
  nextArgs: Record<string, unknown> | undefined,
): { from: Record<string, unknown>; to: Record<string, unknown> } {
  const keys = new Set<string>();
  if (
    prevArgs !== undefined &&
    typeof prevArgs === 'object' &&
    !Array.isArray(prevArgs)
  ) {
    for (const k of Object.keys(prevArgs)) keys.add(k);
  }
  if (
    nextArgs !== undefined &&
    typeof nextArgs === 'object' &&
    !Array.isArray(nextArgs)
  ) {
    for (const k of Object.keys(nextArgs)) keys.add(k);
  }

  const argKeyList = [...keys];
  if (argKeyList.length === 0) {
    return { from: baseRecord, to: baseRecord };
  }

  const slice = sliceIntentAtArgKeys(baseRecord, argKeyList);
  const fromPatch =
    prevArgs !== undefined &&
      typeof prevArgs === 'object' &&
      !Array.isArray(prevArgs) &&
      Object.keys(prevArgs).length > 0
      ? prevArgs
      : {};
  const toPatch =
    nextArgs !== undefined &&
      typeof nextArgs === 'object' &&
      !Array.isArray(nextArgs) &&
      Object.keys(nextArgs).length > 0
      ? nextArgs
      : {};

  return {
    from: applyDotPathPatch(slice, fromPatch, []),
    to: applyDotPathPatch(slice, toPatch, []),
  };
}

/**
 * Keyframe runner: one renderer event per step by default; optional `content.lerp` adds quantized
 * eased ramps between successive keyframes. Config is **only** read from `definition.content` (required
 * object): `repeat`, `length`, `steps`, `lerp`. `content.length` (seconds, finite &gt; 0) is required;
 * at least two steps are stored; the earliest step is pinned to `time: 0` and the latest to `time: length`
 * (centisecond rounding). `parseSteps` uses the same centisecond rounding for each step time and the
 * cycle length when deciding which steps belong in a loop and for `cycleLengthMs`, so the last pinned
 * keyframe is never omitted when raw float seconds disagree slightly with rounded ms. With `content.lerp`, each segment’s substeps are registered after the **previous**
 * anchor’s keyframe is applied so interpolation runs from that last-applied state toward the next anchor (not
 * pre-queued at cycle start, which could run the segment planner before the prior keyframe had fired).
 * In manual run mode, `step` / `goto` / `random` use the same lerp when `content.lerp.time` &gt; 0: ramps are
 * planned from the last **committed** keyframe index (`_lastFiredStepIdx` after the previous jump or lerp
 * finished), not from a timeline neighbour, so arbitrary targets still interpolate from the real prior step.
 * On target intent leaving active scene: pause (clear timers). Re-enter: restart from cycle 0 (v1).
 *
 * Timescale: wall time = `startWall + nominalMs * timescale` ({@link setTimescale}).
 */
export class KeyframeAnimator {
  static readonly uiDescriptor: Record<string, AnimatorFieldDescriptor> = {
    'repeat': { name: 'Repeat', hint: '0 = loop forever', type: 'number', step: 1, range: [0, 1000], stepFunction: 'quadratic', default: 0 },
    'length': { name: 'Length (s)', hint: 'Total cycle length', type: 'number', step: 0.1, range: [0.1, 600], default: 10 },
    'lerp.quantization': { name: 'Quantization', hint: 'Transmit values only when they change', type: 'number', step: 0.01, range: [0.01, 0.5], default: 0.02 },
    'lerp.minMs': { name: 'Min interval (ms)', type: 'number', step: 10, range: [10, 1000], default: 50 },
    'lerp.time': { name: 'Lerp time (s)', hint: '0 = no interpolation', type: 'number', step: 0.1, range: [0, 60], default: 0 },
    'lerp.curve': { name: 'Lerp curve', type: 'string', optionsRef: 'functionCurves', default: 'linear' },
  };

  /** Action trigger commands exposed to controller UIs via systemCapabilities. */
  static commandDescriptors(): { command: string; hint: string; params: Record<string, unknown> }[] {
    return [
      { command: 'step', hint: 'Step to keyframe', params: { offset: { type: 'number', default: 1 } } },
      { command: 'goto', hint: 'Go to given keyframe', params: { idx: { type: 'number', default: 0 } } },
      { command: 'random', hint: 'Go to a random keyframe', params: {} },
    ];
  }

  static readonly defaultValues: Record<string, unknown> = {
    repeat: 0,
    length: 10,
    lerp: {
      quantization: 0.02,
      minMs: 50,
      time: 1,
      curve: 'linear',
    },
    steps: [
      { time: 0 },
      { time: 10 },
    ],
  };

  /**
   * Normalize an incoming animation record for storage: apply class defaults, ensure
   * content shape is canonical, and migrate legacy root-level keys into `content`.
   * Called by AnimationManager — never by graph-store or project manager directly.
   */
  static normalizeRecord(value: Record<string, unknown>, guid: string): Record<string, unknown> {
    const out = cloneRecord(value);
    out['guid'] = guid;

    const keyframeDefaults = cloneRecord(KeyframeAnimator.defaultValues as Record<string, unknown>);
    const existingContent =
      out['content'] && typeof out['content'] === 'object' && !Array.isArray(out['content'])
        ? cloneRecord(out['content'] as Record<string, unknown>)
        : {};

    const rootPatch: Record<string, unknown> = {};
    const rootKeys = ['repeat', 'length', 'lerp', 'steps'];
    for (const k of rootKeys) {
      if (Object.prototype.hasOwnProperty.call(out, k)) {
        rootPatch[k] = out[k];
        delete out[k];
      }
    }

    const mergedContent = applyDotPathPatch(keyframeDefaults, existingContent, []);
    out['content'] = applyDotPathPatch(mergedContent, rootPatch, []);

    const merged = applyDotPathPatch(keyframeDefaults, out, []);
    merged['guid'] = guid;
    if (typeof merged['class'] !== 'string' || merged['class'].length === 0) {
      merged['class'] = 'keyframeAnimator';
    }
    const content =
      merged['content'] && typeof merged['content'] === 'object' && !Array.isArray(merged['content'])
        ? (merged['content'] as Record<string, unknown>)
        : {};
    merged['content'] = content;
    delete merged['repeat'];
    delete merged['length'];
    delete merged['lerp'];
    delete merged['steps'];

    return merged;
  }

  private static defaultLengthSeconds(): number {
    const L = KeyframeAnimator.defaultValues['length'];
    return typeof L === 'number' && Number.isFinite(L) && L > 0 ? L : 10;
  }

  private static getDefaultStepArgsForNewKeyframe(): Record<string, unknown> {
    const stepsRaw = KeyframeAnimator.defaultValues['steps'];
    if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
      return {};
    }
    for (const row of stepsRaw) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const args = (row as Record<string, unknown>)['args'];
      if (
        args !== undefined &&
        typeof args === 'object' &&
        args !== null &&
        !Array.isArray(args) &&
        Object.keys(args as Record<string, unknown>).length > 0
      ) {
        return cloneRecord(args as Record<string, unknown>);
      }
    }
    return {};
  }

  private timers: ReturnType<typeof setTimeout>[] = [];
  private cancelled = false;
  private inScene = true;
  /** Wall ms per nominal definition ms (>1 ⇒ slower). */
  private timescale = 1;

  // ── restart state (set by start(), consumed by setTimescale) ──────────────
  private _runStartWall = 0;
  private _lastFiredCycleIdx = 0;
  private _lastFiredStepIdx = -1;
  /** Re-enters the cycle scheduler from a given cycle + step; set in start(). */
  private _resumeFn?: (cIdx: number, startStepIdx: number) => void;
  /** After `setTimescale` while the last keyframe of a cycle was the last anchor fired, re-queue wrap lerp into step 0. */
  private _lerpRebootstrapWrapFromCycleIdx: number | undefined;
  /** Stored by start() so activateManualMode() can re-emit step 0. */
  private _intentAccess?: IntentAccessFn;
  private _mutateIntent?: MutateIntentFn;
  private _manualModeActive = false;
  /** Frozen by {@link pause} (edit mode); wall time captured so {@link resume} rebases without a jump. */
  private _paused = false;
  private _pausedAtWall = 0;

  // ── edit mode (controller-driven keyframe stepping) ───────────────────────
  private editActive = false;
  private editBindingKey?: string;
  private editBindingMgr?: BindingManager;
  private editIntentAccess?: IntentAccessFn;
  private editMutateIntent?: MutateIntentFn;
  private editTargetGuid?: string;
  private editSteps: { time: number; args?: Record<string, unknown> }[] = [];
  private editSourceIndices: number[] = [];
  private editIndex = 0;
  /** Set in {@link enterEditMode}; snapshot intent after each stepped keyframe for Add-delta. */
  private editCommitIntentBaseline?: (targetGuid: string) => void;
  private editGetIntentDeltaPatch?: (targetGuid: string) => Record<string, unknown>;

  constructor(
    private animationGuid: string,
    private callbacks: KeyframeAnimatorCallbacks,
  ) { }

  setTimescale(factor: number): void {
    if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) {
      Logger.warn('[keyframeAnimator] setTimescale ignored — need finite factor > 0:', factor);
      return;
    }
    if (!this._resumeFn || this.cancelled || !this.inScene) {
      this.timescale = factor;
      return;
    }
    const now = Date.now();
    // Compute exact logical position right now, then rebase startWall at new speed.
    const currentLogicalMs = (now - this._runStartWall) / this.timescale;
    this.timescale = factor;
    this._runStartWall = now - currentLogicalMs * factor;
    this.rescheduleFromLastFired();
  }

  /**
   * Re-queue the cycle scheduler from the last fired step at the current `_runStartWall`/timescale.
   * Shared by {@link setTimescale} and {@link resume}. No-op while paused so a timescale change
   * during edit mode rebases position without secretly un-pausing.
   */
  private rescheduleFromLastFired(): void {
    if (this._paused || !this._resumeFn) {
      return;
    }
    this.stripTimers();
    const { steps: stepsForResume } = this.parseSteps();
    const Lr = stepsForResume.length;
    const nextStepIdx = this._lastFiredStepIdx + 1;
    if (Lr > 0 && nextStepIdx >= Lr) {
      this._lerpRebootstrapWrapFromCycleIdx = this._lastFiredCycleIdx;
      this._resumeFn(this._lastFiredCycleIdx + 1, 0);
    } else {
      this._resumeFn(this._lastFiredCycleIdx, Math.max(0, nextStepIdx));
    }
  }

  /** Freeze at the current position: clear pending timers, remember when, keep runner alive. */
  pause(): void {
    if (this._paused) {
      return;
    }
    this._paused = true;
    this._pausedAtWall = Date.now();
    this.stripTimers();
  }

  /** Continue from the frozen position: shift `_runStartWall` by the paused span, then re-queue. */
  resume(): void {
    if (!this._paused) {
      return;
    }
    this._paused = false;
    if (this.cancelled || !this.inScene) {
      return;
    }
    this._runStartWall += Date.now() - this._pausedAtWall;
    this.rescheduleFromLastFired();
  }

  private wallFromAnimStart(logicalMsFromAnimStart: number): number {
    return this._runStartWall + logicalMsFromAnimStart * this.timescale;
  }

  /** Clears timeouts without emitting status (used when replacing runner on scene re-enter). */
  stripTimers(): void {
    for (const t of this.timers) {
      clearTimeout(t);
    }
    this.timers = [];
  }

  cancel(reason: string): void {
    this.cancelled = true;
    for (const t of this.timers) {
      clearTimeout(t);
    }
    this.timers = [];
    this.callbacks.onStatus({
      status: 'stopped',
      message: { text: reason },
      data: {},
    });
  }

  isCapturableForSnapshot(): boolean {
    if (this.cancelled || !this.inScene) return false;
    if (this._manualModeActive) return false;
    return this.timers.length > 0;
  }

  /**
   * Apply run mode after start(). Must be called after start() has stored intent access.
   * `auto` (default): no-op — the runner plays normally.
   * `manual`: emit step 0, clear all pending timers, pause. Runner stays alive.
   * New modes are added as cases here.
   */
  setRunMode(mode: string): void {
    switch (mode) {
      case 'manual': {
        this._manualModeActive = true;

        const { steps } = this.parseSteps();
        if (
          this.targetIntentGuids().length > 0 &&
          steps.length > 0 &&
          steps[0] &&
          this._intentAccess &&
          this._mutateIntent
        ) {
          this.emitOneKeyframeToAllTargets(
            this._intentAccess,
            this._mutateIntent,
            steps[0].args,
          );
          this._lastFiredStepIdx = 0;
        }

        for (const t of this.timers) {
          clearTimeout(t);
        }
        this.timers = [];

        this._emitManualPausedStatus();
        break;
      }
      case 'auto':
      default:
        // Already playing — nothing to do.
        break;
    }
  }

  /**
   * Execute an action trigger command on a running (manual-mode) animator.
   * Each animator class implements its own command set via switch/case.
   * Called by {@link AnimationManager.trigger} when a runner already exists.
   */
  executeCommand(args: Record<string, unknown>): void {
    const cmd = typeof args['command'] === 'string' ? args['command'] : '';
    switch (cmd) {
      case 'step': {
        const offset = typeof args['offset'] === 'number' && Number.isFinite(args['offset']) ? Math.round(args['offset']) : 1;
        const { steps } = this.parseSteps();
        if (this.targetIntentGuids().length === 0 || steps.length === 0 || !this._intentAccess || !this._mutateIntent) return;
        const lastAppliedStepIdx = this._lastFiredStepIdx < 0 ? 0 : this._lastFiredStepIdx;
        const L = steps.length;
        const nextIdx = ((lastAppliedStepIdx + offset) % L + L) % L;
        if (nextIdx === lastAppliedStepIdx) {
          this._lastFiredStepIdx = lastAppliedStepIdx;
          this._emitManualPausedStatus();
          break;
        }
        this.stripTimers();
        const lerp = this.parseContentLerp();
        if (lerp) {
          this.forEachTarget(targetGuid => {
            this.scheduleManualWallLerpBetweenStepIndices(
              targetGuid,
              steps,
              lastAppliedStepIdx,
              nextIdx,
              lerp,
              this._intentAccess!,
              this._mutateIntent!,
            );
          });
        } else {
          this._lastFiredStepIdx = nextIdx;
          const step = steps[nextIdx];
          if (step) {
            this.emitOneKeyframeToAllTargets(this._intentAccess, this._mutateIntent, step.args);
          }
          this._emitManualPausedStatus();
        }
        break;
      }
      case 'goto': {
        const idx = typeof args['idx'] === 'number' && Number.isFinite(args['idx']) ? Math.round(args['idx']) : 0;
        const { steps } = this.parseSteps();
        if (this.targetIntentGuids().length === 0 || steps.length === 0 || !this._intentAccess || !this._mutateIntent) return;
        const lastAppliedStepIdx = this._lastFiredStepIdx < 0 ? 0 : this._lastFiredStepIdx;
        const clamped = Math.max(0, Math.min(steps.length - 1, idx));
        if (clamped === lastAppliedStepIdx) {
          this._lastFiredStepIdx = lastAppliedStepIdx;
          this._emitManualPausedStatus();
          break;
        }
        this.stripTimers();
        const lerp = this.parseContentLerp();
        if (lerp) {
          this.forEachTarget(targetGuid => {
            this.scheduleManualWallLerpBetweenStepIndices(
              targetGuid,
              steps,
              lastAppliedStepIdx,
              clamped,
              lerp,
              this._intentAccess!,
              this._mutateIntent!,
            );
          });
        } else {
          this._lastFiredStepIdx = clamped;
          const step = steps[clamped];
          if (step) {
            this.emitOneKeyframeToAllTargets(this._intentAccess, this._mutateIntent, step.args);
          }
          this._emitManualPausedStatus();
        }
        break;
      }
      case 'random': {
        const { steps } = this.parseSteps();
        if (this.targetIntentGuids().length === 0 || steps.length === 0 || !this._intentAccess || !this._mutateIntent) return;
        const L = steps.length;
        if (L === 1) {
          this._lastFiredStepIdx = 0;
          this.emitOneKeyframeToAllTargets(this._intentAccess, this._mutateIntent, steps[0]!.args);
          this._emitManualPausedStatus();
          break;
        }
        const lastAppliedStepIdx = this._lastFiredStepIdx < 0 ? 0 : this._lastFiredStepIdx;
        let idx: number;
        do {
          idx = Math.floor(Math.random() * L);
        } while (idx === lastAppliedStepIdx);
        this.stripTimers();
        const lerp = this.parseContentLerp();
        if (lerp) {
          this.forEachTarget(targetGuid => {
            this.scheduleManualWallLerpBetweenStepIndices(
              targetGuid,
              steps,
              lastAppliedStepIdx,
              idx,
              lerp,
              this._intentAccess!,
              this._mutateIntent!,
            );
          });
        } else {
          this._lastFiredStepIdx = idx;
          const step = steps[idx];
          if (step) {
            this.emitOneKeyframeToAllTargets(this._intentAccess, this._mutateIntent, step.args);
          }
          this._emitManualPausedStatus();
        }
        break;
      }
      default:
        Logger.warn(`[keyframeAnimator] unknown command "${cmd}"`);
        break;
    }
  }

  private _emitManualPausedStatus(): void {
    const { steps } = this.parseSteps();
    const displayIdx = Math.max(0, this._lastFiredStepIdx) + 1;
    this.callbacks.onStatus({
      status: 'paused',
      message: { text: `Manual mode — paused at step ${displayIdx}` },
      data: { manualMode: true, step: this._lastFiredStepIdx, total: steps.length },
    });
  }

  onSceneMembershipChanged(inScene: boolean): void {
    this.inScene = inScene;
    if (!inScene) {
      for (const t of this.timers) {
        clearTimeout(t);
      }
      this.timers = [];
      this.callbacks.onStatus({
        status: 'paused',
        message: { text: 'Target intent left active scene' },
        data: {},
      });
    }
  }

  /**
   * Enter live keyframe-stepping edit mode. Caller has already stopped any runner.
   * The animator owns its own master binding (`${guid}-editState`) and emits step 0 immediately.
   * editState shape and binding lifecycle are private to this class — AnimationManager only
   * forwards the deps and calls exitEditMode on teardown.
   */
  enterEditMode(deps: {
    intentAccess: IntentAccessFn;
    mutateIntent: MutateIntentFn;
    bindingManager: BindingManager;
    commitEditIntentBaseline: (targetGuid: string) => void;
    getEditIntentDeltaPatch: (targetGuid: string) => Record<string, unknown>;
  }): void {
    if (this.editActive) return;

    const raw = this.callbacks.getDefinitionRecord();
    if (!raw) {
      this.callbacks.onStatus({
        status: 'stopped',
        message: { text: 'Animation not in project (edit aborted)' },
        data: {},
      });
      return;
    }
    let contentTouched = this.ensureContentObjectOnRecord(raw);
    const normalized = this.normalizeStoredStepsAndRefresh();
    contentTouched ||= normalized.changed;
    if (contentTouched) {
      this.callbacks.onDefinitionChanged?.();
    }

    const { steps, stepSourceIndices, parseError } = this.parseSteps();
    const targetGuid = this.targetIntentGuids()[0];

    if (!targetGuid) {
      this.callbacks.onStatus({
        status: 'stopped',
        message: { text: 'No targetIntents (edit aborted)' },
        data: {},
      });
      return;
    }
    if (parseError === 'no_content') {
      this.callbacks.onStatus({
        status: 'stopped',
        message: { text: 'keyframeAnimator requires definition.content object' },
        data: {},
      });
      return;
    }
    if (parseError === 'invalid_length') {
      this.callbacks.onStatus({
        status: 'stopped',
        message: { text: 'keyframeAnimator requires finite content.length > 0' },
        data: {},
      });
      return;
    }
    if (steps.length < 2) {
      this.callbacks.onStatus({
        status: 'stopped',
        message: { text: 'keyframeAnimator requires at least two keyframe steps' },
        data: {},
      });
      return;
    }

    this.editActive = true;
    this.editIntentAccess = deps.intentAccess;
    this.editMutateIntent = deps.mutateIntent;
    this.editCommitIntentBaseline = deps.commitEditIntentBaseline;
    this.editGetIntentDeltaPatch = deps.getEditIntentDeltaPatch;
    this.editBindingMgr = deps.bindingManager;
    this.editBindingKey = `${this.animationGuid}-editState`;
    this.editTargetGuid = targetGuid;
    this.editSteps = steps;
    this.editSourceIndices = stepSourceIndices;
    this.editIndex = 0;

    this.emitCurrentEditStep();

    deps.bindingManager.registerMaster(
      this.editBindingKey,
      () => this.computeEditState(),
      value => this.applyEditState(value),
    );
  }

  /**
   * Call when `definition.content` was updated outside the keyframe edit binding (e.g. graph patch to
   * `content.length`). Re-runs step normalization, pushes edit-state binding, and re-emits the current
   * keyframe. Hub uses the return value to fan out a supplemental `content.steps` graph patch.
   * @returns true if stored `content.steps` were modified.
   */
  reconcileStoredStepsAfterGraphMutation(): boolean {
    if (!this.editActive) return false;
    const preferred =
      this.editSteps.length > 0 && typeof this.editSourceIndices[this.editIndex] === 'number'
        ? this.editSourceIndices[this.editIndex]
        : undefined;
    const { changed } = this.normalizeStoredStepsAndRefresh(preferred);
    if (changed) {
      this.callbacks.onDefinitionChanged?.();
    }
    if (this.editBindingMgr && this.editBindingKey) {
      this.editBindingMgr.receiveFromMaster(this.editBindingKey, this.computeEditState());
    }
    this.emitCurrentEditStep();
    return changed;
  }

  exitEditMode(): void {
    if (!this.editActive) return;
    if (this.editBindingMgr && this.editBindingKey) {
      this.editBindingMgr.unregisterMaster(this.editBindingKey);
    }
    this.editActive = false;
    delete this.editBindingMgr;
    delete this.editBindingKey;
    delete this.editIntentAccess;
    delete this.editMutateIntent;
    delete this.editCommitIntentBaseline;
    delete this.editGetIntentDeltaPatch;
    delete this.editTargetGuid;
    this.editSteps = [];
    this.editSourceIndices = [];
    this.editIndex = 0;
  }

  private computeEditState(): {
    totalSteps: number;
    currentStepIndex: number;
    currentStepContent: unknown;
    prevStepTimeSec: number | null;
    nextStepTimeSec: number | null;
    explicitAnimationLengthSec: number | null;
  } {
    const total = this.editSteps.length;
    const idx = total > 0 ? Math.max(0, Math.min(total - 1, this.editIndex)) : 0;
    const step = this.editSteps[idx];
    const prevStep = idx > 0 ? this.editSteps[idx - 1] : undefined;
    const nextStep = idx < total - 1 ? this.editSteps[idx + 1] : undefined;
    const lenMs = this.parseExplicitAnimationLengthMs();
    const explicitAnimationLengthSec =
      lenMs !== undefined
        ? this.roundTimeMsToHundredthSecond(lenMs) / 1000
        : null;
    return {
      totalSteps: total,
      currentStepIndex: idx,
      currentStepContent: step ? this.toExternalEditStep(step) : null,
      prevStepTimeSec:
        prevStep !== undefined
          ? this.roundTimeMsToHundredthSecond(prevStep.time) / 1000
          : null,
      nextStepTimeSec:
        nextStep !== undefined
          ? this.roundTimeMsToHundredthSecond(nextStep.time) / 1000
          : null,
      explicitAnimationLengthSec,
    };
  }

  private applyEditState(value: unknown): void {
    if (!this.editActive) return;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      Logger.warn('[keyframeAnimator] applyEditState ignored — non-object value');
      return;
    }
    const total = this.editSteps.length;
    if (total === 0) return;

    const incoming = value as Record<string, unknown>;
    const previousIndex = this.editIndex;
    const rawIdx = incoming['currentStepIndex'];
    if (typeof rawIdx !== 'number' || !Number.isFinite(rawIdx)) {
      Logger.warn('[keyframeAnimator] applyEditState ignored — invalid currentStepIndex');
      return;
    }
    const clamped = Math.max(0, Math.min(total - 1, Math.floor(rawIdx)));
    if (clamped !== this.editIndex) {
      this.editIndex = clamped;
      this.emitCurrentEditStep();
    }
    const action = incoming['editAction'];
    if (action === 'remove') {
      if (this.removeCurrentStep()) {
        this.callbacks.onDefinitionChanged?.();
      }
      if (this.editBindingMgr && this.editBindingKey) {
        this.editBindingMgr.receiveFromMaster(this.editBindingKey, this.computeEditState());
      }
      return;
    }
    if (action === 'add') {
      const tg = this.editTargetGuid;
      const getDelta = this.editGetIntentDeltaPatch;
      if (!tg || !getDelta) {
        Logger.warn('[keyframeAnimator] add ignored — edit delta provider missing');
      } else {
        let patch = getDelta(tg);
        if (Object.keys(patch).length === 0) {
          patch = KeyframeAnimator.getDefaultStepArgsForNewKeyframe();
        }
        const plan = this.planAddKeyframe(this.editIndex);
        if (!plan.ok) {
          Logger.warn(`[keyframeAnimator] add ignored — ${plan.reason}`);
        } else {
          if (plan.shiftLastStep) {
            const existing = this.editSteps[this.editIndex];
            const shiftedStep: { time: number; args?: Record<string, unknown> } = {
              time: plan.shiftLastStep.timeMs,
              ...(existing?.args !== undefined ? { args: existing.args } : {}),
            };
            this.persistEditedStep(plan.shiftLastStep.sourceIndex, shiftedStep);
          }
          const incomingStep: { time: number; args?: Record<string, unknown> } = {
            time: plan.timeMs,
            ...(Object.keys(patch).length > 0 ? { args: patch } : {}),
          };
          const sourceIndex = this.insertNewStep(incomingStep);
          if (sourceIndex >= 0) {
            this.normalizeStoredStepsAndRefresh(sourceIndex);
            this.callbacks.onDefinitionChanged?.();
            this.emitCurrentEditStep();
          }
        }
      }
      if (this.editBindingMgr && this.editBindingKey) {
        this.editBindingMgr.receiveFromMaster(this.editBindingKey, this.computeEditState());
      }
      return;
    }
    if (action === 'merge') {
      const tg = this.editTargetGuid;
      const getDelta = this.editGetIntentDeltaPatch;
      if (!tg || !getDelta) {
        Logger.warn('[keyframeAnimator] merge ignored — edit delta provider missing');
      } else {
        const curStep = this.editSteps[this.editIndex];
        const timeMs = curStep?.time;
        const sourceIndex = this.editSourceIndices[this.editIndex];
        if (
          typeof timeMs !== 'number' ||
          !Number.isFinite(timeMs) ||
          typeof sourceIndex !== 'number' ||
          !Number.isFinite(sourceIndex) ||
          sourceIndex < 0
        ) {
          Logger.warn('[keyframeAnimator] merge ignored — invalid current step');
        } else {
          const delta = getDelta(tg);
          const baseArgs =
            curStep?.args !== undefined &&
              typeof curStep.args === 'object' &&
              curStep.args !== null &&
              !Array.isArray(curStep.args)
              ? cloneRecord(curStep.args as Record<string, unknown>)
              : {};
          const merged: Record<string, unknown> = { ...baseArgs, ...delta };
          const incomingStep: { time: number; args?: Record<string, unknown> } = {
            time: timeMs,
            ...(Object.keys(merged).length > 0 ? { args: merged } : {}),
          };
          this.persistEditedStep(sourceIndex, incomingStep);
          this.normalizeStoredStepsAndRefresh(sourceIndex);
          this.callbacks.onDefinitionChanged?.();
          this.emitCurrentEditStep();
        }
      }
      if (this.editBindingMgr && this.editBindingKey) {
        this.editBindingMgr.receiveFromMaster(this.editBindingKey, this.computeEditState());
      }
      return;
    }
    const indexChanged = clamped !== previousIndex;
    if (Object.prototype.hasOwnProperty.call(incoming, 'currentStepContent') && !indexChanged) {
      const lenMs = this.parseExplicitAnimationLengthMs();
      const incomingStep = this.parseIncomingEditStep(
        incoming['currentStepContent'],
        this.editSteps[this.editIndex],
        lenMs !== undefined
          ? { idx: this.editIndex, total, targetLastMs: lenMs }
          : undefined,
      );
      if (incomingStep) {
        const sourceIndex = this.editSourceIndices[this.editIndex];
        if (typeof sourceIndex === 'number') {
          this.persistEditedStep(sourceIndex, incomingStep);
          this.normalizeStoredStepsAndRefresh(sourceIndex);
          this.callbacks.onDefinitionChanged?.();
        } else {
          this.editSteps[this.editIndex] = incomingStep;
        }
        this.emitCurrentEditStep();
      }
    }
    if (this.editBindingMgr && this.editBindingKey) {
      this.editBindingMgr.receiveFromMaster(this.editBindingKey, this.computeEditState());
    }
  }

  private parseIncomingEditStep(
    value: unknown,
    fallback?: { time: number; args?: Record<string, unknown> },
    clampFirstLast?: { idx: number; total: number; targetLastMs: number },
  ): { time: number; args?: Record<string, unknown> } | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      Logger.warn('[keyframeAnimator] applyEditState ignored — currentStepContent must be an object');
      return null;
    }
    const row = value as Record<string, unknown>;
    const fallbackTime = fallback?.time ?? 0;
    const rawTime = row['time'];
    let time =
      typeof rawTime === 'number' && Number.isFinite(rawTime) && rawTime >= 0
        ? this.roundTimeMsToHundredthSecond(rawTime * 1000)
        : fallbackTime;

    if (clampFirstLast && clampFirstLast.total >= 2) {
      if (clampFirstLast.idx === 0) {
        time = 0;
      }
      if (clampFirstLast.idx === clampFirstLast.total - 1) {
        time = this.roundTimeMsToHundredthSecond(clampFirstLast.targetLastMs);
      }
    }

    const rawArgs = row['args'];
    if (rawArgs === undefined) {
      return { time };
    }
    if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
      Logger.warn('[keyframeAnimator] applyEditState ignored — currentStepContent.args must be an object');
      return null;
    }
    return { time, args: rawArgs as Record<string, unknown> };
  }

  private toExternalEditStep(step: { time: number; args?: Record<string, unknown> }): {
    time: number;
    args?: Record<string, unknown>;
  } {
    const time = this.roundTimeMsToHundredthSecond(step.time) / 1000;
    if (step.args !== undefined) {
      return { time, args: step.args };
    }
    return { time };
  }

  private emitCurrentEditStep(): void {
    if (!this.editTargetGuid || !this.editIntentAccess || !this.editMutateIntent) return;
    const step = this.editSteps[this.editIndex];
    if (!step) return;
    this.emitOneKeyframe(this.editTargetGuid, this.editIntentAccess, this.editMutateIntent, step.args);
    if (this.editCommitIntentBaseline) {
      this.editCommitIntentBaseline(this.editTargetGuid);
    }
  }

  /** Round to centiseconds (2 decimals in seconds) to keep persisted keyframe times stable. */
  private roundTimeMsToHundredthSecond(timeMs: number): number {
    if (!Number.isFinite(timeMs)) return 0;
    return Math.round(timeMs / 10) * 10;
  }

  private toStoredStepTimeSeconds(timeMs: number): number {
    return this.roundTimeMsToHundredthSecond(timeMs) / 1000;
  }

  /**
   * `content.length` (seconds → ms). Undefined when `content` is missing or `length` is invalid.
   */
  private parseExplicitAnimationLengthMs(): number | undefined {
    const cfg = this.keyframeConfigBag();
    if (!cfg) return undefined;
    const lenRaw = cfg['length'];
    if (typeof lenRaw === 'number' && Number.isFinite(lenRaw) && lenRaw > 0) {
      return lenRaw * 1000;
    }
    return undefined;
  }

  /**
   * Plan for inserting a new keyframe relative to {@link editIndex}:
   * - non-last step: new step takes the midpoint between current and next; no shift.
   * - last step: new step takes the current last step's time (= `content.length`) and the existing
   *   last step is moved inward to the midpoint of (prev-of-last, current last) so the animation
   *   length is preserved.
   */
  private planAddKeyframe(editIndex: number):
    | { ok: true; timeMs: number; shiftLastStep?: { sourceIndex: number; timeMs: number } }
    | { ok: false; reason: string } {
    const cur = this.editSteps[editIndex];
    if (!cur) {
      return { ok: false, reason: 'invalid step index for time' };
    }
    const next = this.editSteps[editIndex + 1];
    if (next !== undefined) {
      return { ok: true, timeMs: this.roundTimeMsToHundredthSecond((cur.time + next.time) / 2) };
    }
    const prev = this.editSteps[editIndex - 1];
    if (!prev) {
      return { ok: false, reason: 'no previous step to make room for last-step insertion' };
    }
    const curLastSourceIndex = this.editSourceIndices[editIndex];
    if (typeof curLastSourceIndex !== 'number' || curLastSourceIndex < 0) {
      return { ok: false, reason: 'invalid source index for existing last step' };
    }
    const newStepTimeMs = this.roundTimeMsToHundredthSecond(cur.time);
    const shiftedTimeMs = this.roundTimeMsToHundredthSecond((prev.time + cur.time) / 2);
    const prevR = this.roundTimeMsToHundredthSecond(prev.time);
    if (shiftedTimeMs <= prevR || shiftedTimeMs >= newStepTimeMs) {
      return { ok: false, reason: 'no room between previous step and animation end' };
    }
    return {
      ok: true,
      timeMs: newStepTimeMs,
      shiftLastStep: { sourceIndex: curLastSourceIndex, timeMs: shiftedTimeMs },
    };
  }

  private persistEditedStep(
    sourceIndex: number,
    step: { time: number; args?: Record<string, unknown> },
  ): void {
    if (!Number.isFinite(sourceIndex) || sourceIndex < 0) return;
    const cfg = this.keyframeConfigBag();
    if (!cfg) return;
    const rawSteps = cfg['steps'];
    if (!Array.isArray(rawSteps)) return;
    const existing = rawSteps[sourceIndex];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return;

    const timeSeconds = this.toStoredStepTimeSeconds(step.time);
    const nextRow: Record<string, unknown> = {
      ...(existing as Record<string, unknown>),
      time: Number.isFinite(timeSeconds) ? timeSeconds : 0,
    };
    if (step.args !== undefined) {
      nextRow['args'] = step.args;
    } else {
      delete nextRow['args'];
    }
    rawSteps[sourceIndex] = nextRow;
  }

  private removeCurrentStep(): boolean {
    if (this.editSteps.length <= 2) return false;
    const sourceIndex = this.editSourceIndices[this.editIndex];
    if (typeof sourceIndex !== 'number' || !Number.isFinite(sourceIndex) || sourceIndex < 0) return false;
    const cfg = this.keyframeConfigBag();
    if (!cfg) return false;
    const rawSteps = cfg['steps'];
    if (!Array.isArray(rawSteps)) return false;
    if (sourceIndex >= rawSteps.length) return false;
    rawSteps.splice(sourceIndex, 1);
    this.normalizeStoredStepsAndRefresh();
    return true;
  }

  private insertNewStep(step: { time: number; args?: Record<string, unknown> }): number {
    const cfg = this.keyframeConfigBag();
    if (!cfg) {
      Logger.warn('[keyframeAnimator] insertNewStep ignored — animation definition not in project');
      return -1;
    }
    if (!Array.isArray(cfg['steps'])) cfg['steps'] = [];
    const rawSteps = cfg['steps'] as unknown[];
    const row: Record<string, unknown> = { time: this.toStoredStepTimeSeconds(step.time) };
    if (step.args !== undefined) row['args'] = step.args;
    rawSteps.push(row);
    return rawSteps.length - 1;
  }

  private refreshEditStepsFromConfig(preferredSourceIndex?: number): void {
    const previousIndex = this.editIndex;
    const { steps, stepSourceIndices } = this.parseSteps();
    this.editSteps = steps;
    this.editSourceIndices = stepSourceIndices;
    if (steps.length === 0) {
      this.editIndex = 0;
      return;
    }
    if (typeof preferredSourceIndex === 'number') {
      const movedIndex = stepSourceIndices.indexOf(preferredSourceIndex);
      if (movedIndex >= 0) {
        this.editIndex = movedIndex;
        return;
      }
    }
    this.editIndex = Math.max(0, Math.min(steps.length - 1, previousIndex));
  }

  /** @returns true if `content` was created on the record. */
  private ensureContentObjectOnRecord(raw: Record<string, unknown>): boolean {
    const c = raw['content'];
    if (c !== undefined && typeof c === 'object' && c !== null && !Array.isArray(c)) {
      return false;
    }
    raw['content'] = cloneRecord(KeyframeAnimator.defaultValues as Record<string, unknown>);
    return true;
  }

  private ensureValidLengthOnConfig(cfg: Record<string, unknown>): boolean {
    const lenRaw = cfg['length'];
    if (typeof lenRaw === 'number' && Number.isFinite(lenRaw) && lenRaw > 0) {
      return false;
    }
    cfg['length'] = KeyframeAnimator.defaultLengthSeconds();
    return true;
  }

  private stripEmptyArgsFromRow(row: Record<string, unknown>): boolean {
    const a = row['args'];
    if (a === undefined) return false;
    if (
      typeof a === 'object' &&
      a !== null &&
      !Array.isArray(a) &&
      Object.keys(a as Record<string, unknown>).length === 0
    ) {
      delete row['args'];
      return true;
    }
    return false;
  }

  private pinFirstLastStable(ordered: Record<string, unknown>[], targetLastMs: number): boolean {
    let mutated = false;
    const Lsec = this.toStoredStepTimeSeconds(targetLastMs);
    const targetRounded = this.roundTimeMsToHundredthSecond(targetLastMs);
    const n = ordered.length;
    if (n < 2) return false;

    const stableSort = (): void => {
      for (let i = 0; i < ordered.length; i++) {
        ordered[i]!['__kfs'] = i;
      }
      ordered.sort((a, b) => {
        const ta = Number(a['time']) * 1000;
        const tb = Number(b['time']) * 1000;
        const ra = Number.isFinite(ta) ? this.roundTimeMsToHundredthSecond(ta) : 0;
        const rb = Number.isFinite(tb) ? this.roundTimeMsToHundredthSecond(tb) : 0;
        if (ra !== rb) return ra - rb;
        return Number(a['__kfs']) - Number(b['__kfs']);
      });
      for (const r of ordered) {
        delete r['__kfs'];
      }
    };

    for (let iter = 0; iter < n + 6; iter++) {
      stableSort();
      const first = ordered[0];
      const last = ordered[n - 1];
      if (!first || !last) return mutated;
      const prevFirst = first['time'];
      const prevLast = last['time'];
      first['time'] = 0;
      last['time'] = Lsec;
      if (prevFirst !== 0 || prevLast !== Lsec) {
        mutated = true;
      }
      stableSort();
      const tail = ordered[n - 1];
      if (!tail) return mutated;
      const tailMs = this.roundTimeMsToHundredthSecond(Number(tail['time']) * 1000);
      if (tailMs === targetRounded) break;
      mutated = true;
    }
    return mutated;
  }

  /**
   * Canonicalize stored `steps`: stable sort by time, at least two steps, first `time` 0 and last `time`
   * = `content.length`, omit empty `args`. Returns whether durable animation content was modified.
   */
  private normalizeStoredStepsAndRefresh(preferredSourceIndex?: number): { changed: boolean } {
    let changed = false;
    const cfg = this.keyframeConfigBag();
    if (!cfg) {
      this.refreshEditStepsFromConfig(preferredSourceIndex);
      return { changed };
    }
    if (this.ensureValidLengthOnConfig(cfg)) {
      changed = true;
    }
    const lenMs = this.parseExplicitAnimationLengthMs();
    if (lenMs === undefined) {
      this.refreshEditStepsFromConfig(preferredSourceIndex);
      return { changed };
    }
    const lenSec = this.toStoredStepTimeSeconds(lenMs);

    if (!Array.isArray(cfg['steps'])) {
      cfg['steps'] = [];
      changed = true;
    }
    const rawSteps = cfg['steps'] as unknown[];

    type RowEntry = { row: Record<string, unknown>; sourceIndex: number; timeMs: number };
    const entries: RowEntry[] = [];
    for (let index = 0; index < rawSteps.length; index++) {
      const raw = rawSteps[index];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      const t = Number(row['time']) * 1000;
      if (!Number.isFinite(t)) continue;
      entries.push({
        row,
        sourceIndex: index,
        timeMs: this.roundTimeMsToHundredthSecond(t),
      });
    }
    entries.sort((a, b) => (a.timeMs === b.timeMs ? a.sourceIndex - b.sourceIndex : a.timeMs - b.timeMs));

    let ordered: Record<string, unknown>[] = entries.map(e => e.row);

    if (ordered.length === 0) {
      cfg['steps'] = [{ time: 0 }, { time: lenSec }];
      changed = true;
      this.refreshEditStepsFromConfig(preferredSourceIndex);
      return { changed };
    }

    if (ordered.length === 1) {
      ordered.push({ time: lenSec });
      changed = true;
    }

    if (this.pinFirstLastStable(ordered, lenMs)) {
      changed = true;
    }

    for (const row of ordered) {
      if (this.stripEmptyArgsFromRow(row)) {
        changed = true;
      }
    }

    cfg['steps'] = ordered;

    let mappedPreferred: number | undefined;
    if (typeof preferredSourceIndex === 'number' && preferredSourceIndex >= 0) {
      const ref = rawSteps[preferredSourceIndex];
      if (ref && typeof ref === 'object' && !Array.isArray(ref)) {
        const idx = ordered.indexOf(ref as Record<string, unknown>);
        if (idx >= 0) mappedPreferred = idx;
      }
    }
    this.refreshEditStepsFromConfig(mappedPreferred);
    return { changed };
  }

  /** Keyframe config is read only from `definition.content`. */
  private keyframeConfigBag(): Record<string, unknown> | null {
    const raw = this.callbacks.getDefinitionRecord();
    if (!raw) return null;
    const content = raw['content'];
    if (
      content !== undefined &&
      typeof content === 'object' &&
      content !== null &&
      !Array.isArray(content)
    ) {
      return content as Record<string, unknown>;
    }
    return null;
  }

  /** Optional `content.lerp`: `minMs` (nominal) lower-bounds spacing between successive lerp `events` (`× timescale` on hub wall clock). Omit or omit `lerp.minMs` → quantization-only cardinality. */
  private parseContentLerp():
    | {
      timeMs: number;
      quantizationEff: number;
      curveName: unknown;
      minNominalMs?: number;
    }
    | null {
    const cfg = this.keyframeConfigBag();
    if (!cfg) return null;
    const lerp = cfg['lerp'];
    if (!lerp || typeof lerp !== 'object' || Array.isArray(lerp)) {
      return null;
    }
    const lr = lerp as Record<string, unknown>;
    const timeRaw = lr['time'];
    if (typeof timeRaw !== 'number' || !Number.isFinite(timeRaw) || timeRaw <= 0) {
      return null;
    }
    let minNominalMs: number | undefined;
    const minRaw = lr['minMs'];
    if (typeof minRaw === 'number' && Number.isFinite(minRaw) && minRaw > 0) {
      minNominalMs = minRaw;
    }

    const out = {
      timeMs: timeRaw * 1000,
      quantizationEff: effectiveLerpQuantization(lr['quantization']),
      curveName: lr['curve'],
      ...(minNominalMs !== undefined ? { minNominalMs } : {}),
    };
    return out;
  }

  private parseSteps(): {
    steps: { time: number; args?: Record<string, unknown> }[];
    stepSourceIndices: number[];
    repeatLoops: number;
    cycleLengthMs: number;
    lengthClampActive: boolean;
    clippedByLength: boolean;
    parseError?: 'no_content' | 'invalid_length';
  } {
    const cfg = this.keyframeConfigBag();
    if (!cfg) {
      return {
        steps: [],
        stepSourceIndices: [],
        repeatLoops: 0,
        cycleLengthMs: 0,
        lengthClampActive: false,
        clippedByLength: false,
        parseError: 'no_content',
      };
    }
    const stepsRaw = cfg['steps'];
    const arr = Array.isArray(stepsRaw) ? stepsRaw : [];
    const parsed: { time: number; args?: Record<string, unknown>; _index: number }[] = [];
    for (let index = 0; index < arr.length; index++) {
      const item = arr[index];
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      const time = Number(row['time']) * 1000;
      if (!Number.isFinite(time)) continue;
      const args = row['args'];
      let entry: { time: number; args?: Record<string, unknown>; _index: number };
      if (args !== undefined && typeof args === 'object' && !Array.isArray(args)) {
        entry = { time, args: args as Record<string, unknown>, _index: index };
      } else {
        entry = { time, _index: index };
      }
      parsed.push(entry);
    }
    const sortedEntries = parsed.sort((a, b) => (a.time === b.time ? a._index - b._index : a.time - b.time));
    const sorted = sortedEntries.map(p => (p.args !== undefined ? { time: p.time, args: p.args } : { time: p.time }));
    const sortedIndices = sortedEntries.map(p => p._index);

    const repeatRaw = cfg['repeat'];
    const repeatLoops =
      typeof repeatRaw === 'number' && Number.isFinite(repeatRaw) && repeatRaw >= 0 ? repeatRaw : 0;

    const lenRaw = cfg['length'];
    const lengthMs =
      typeof lenRaw === 'number' && Number.isFinite(lenRaw) && lenRaw > 0 ? lenRaw * 1000 : undefined;

    if (lengthMs === undefined) {
      return {
        steps: [],
        stepSourceIndices: [],
        repeatLoops,
        cycleLengthMs: 0,
        lengthClampActive: false,
        clippedByLength: false,
        parseError: 'invalid_length',
      };
    }

    const lengthMsRounded = this.roundTimeMsToHundredthSecond(lengthMs);

    const steps: { time: number; args?: Record<string, unknown> }[] = [];
    const stepSourceIndices: number[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const row = sorted[i];
      const sourceIndex = sortedIndices[i];
      if (!row || typeof sourceIndex !== 'number') continue;
      const timeRounded = this.roundTimeMsToHundredthSecond(row.time);
      if (timeRounded > lengthMsRounded) continue;
      steps.push(
        row.args !== undefined
          ? { time: timeRounded, args: row.args }
          : { time: timeRounded },
      );
      stepSourceIndices.push(sourceIndex);
    }
    const cycleLengthMs = lengthMsRounded;

    return {
      steps,
      stepSourceIndices,
      repeatLoops,
      cycleLengthMs,
      lengthClampActive: true,
      clippedByLength: sorted.length > steps.length,
    };
  }

  private targetIntentGuids(): string[] {
    return resolveAnimationTargetIntents(this.callbacks.getDefinitionRecord());
  }

  /** @param {(targetGuid: string) => void} fn */
  private forEachTarget(fn: (targetGuid: string) => void): void {
    for (const g of this.targetIntentGuids()) {
      fn(g);
    }
  }

  private emitOneKeyframeToAllTargets(
    intentAccess: IntentAccessFn,
    mutateIntent: MutateIntentFn,
    stepArgs: Record<string, unknown> | undefined,
  ): void {
    this.forEachTarget(targetGuid => {
      this.emitOneKeyframe(targetGuid, intentAccess, mutateIntent, stepArgs);
    });
  }

  private pushTimeoutAtFireWall(
    fireWallAbs: number,
    run: (fireAt: number) => void,
  ): void {
    const delay = Math.max(0, fireWallAbs - Date.now());
    const t = setTimeout(() => {
      run(fireWallAbs);
    }, delay);
    this.timers.push(t);
  }

  private scheduleManualWallLerpBetweenStepIndices(
    targetGuid: string,
    steps: { time: number; args?: Record<string, unknown> }[],
    lastAppliedStepIdx: number,
    targetStepIdx: number,
    lerp: {
      timeMs: number;
      quantizationEff: number;
      curveName: unknown;
      minNominalMs?: number;
    },
    intentAccess: IntentAccessFn,
    mutateIntent: MutateIntentFn,
  ): void {
    const prevStep = steps[lastAppliedStepIdx];
    const nextStep = steps[targetStepIdx];
    if (!prevStep || !nextStep) {
      return;
    }

    const segmentStartMs = Date.now();
    const span = lerp.timeMs * this.timescale;

    const baseIntent = intentAccess(targetGuid);
    if (!baseIntent) {
      this.cancel('Target intent unavailable');
      return;
    }
    const baseRecord = baseIntent as unknown as Record<string, unknown>;
    const { from: fromResolvedRaw, to: toResolvedRaw } = lerpPlanEndpoints(
      baseRecord,
      prevStep.args,
      nextStep.args,
    );

    const planOpts: PlanIntermediateLerpOptions = {};
    if (typeof lerp.minNominalMs === 'number' && Number.isFinite(lerp.minNominalMs)) {
      planOpts.segmentWallSpanMs = span;
      planOpts.minGapWallMs = lerp.minNominalMs * this.timescale;
    }

    const planned = planIntermediateLerpPatches(
      fromResolvedRaw,
      toResolvedRaw,
      lerp.quantizationEff,
      lerp.curveName,
      planOpts,
    );

    const finishManualNavigation = (): void => {
      if (this.cancelled || !this.inScene) return;
      this._lastFiredStepIdx = targetStepIdx;
      this.emitOneKeyframe(targetGuid, intentAccess, mutateIntent, nextStep.args);
      this._emitManualPausedStatus();
    };

    if (planned.intermediateDotPatches.length === 0) {
      finishManualNavigation();
      return;
    }

    const denom = planned.n - 1;

    for (let k = 0; k < planned.intermediateDotPatches.length; k++) {
      const dotPatch = planned.intermediateDotPatches[k];
      if (dotPatch === undefined) continue;
      const fireWallAbs = segmentStartMs + (k / denom) * span;
      const patchRecord = dotPatch as Record<string, unknown>;

      this.pushTimeoutAtFireWall(fireWallAbs, () => {
        if (this.cancelled || !this.inScene) return;
        if (Object.keys(patchRecord).length === 0) return;
        mutateIntent(targetGuid, patchRecord);
      });
    }

    this.pushTimeoutAtFireWall(segmentStartMs + span, () => {
      finishManualNavigation();
    });
  }

  private emitOneKeyframe(
    targetGuid: string,
    intentAccess: IntentAccessFn,
    mutateIntent: MutateIntentFn,
    stepArgs: Record<string, unknown> | undefined,
  ): void {
    if (this.cancelled || !this.inScene) return;

    if (
      stepArgs === undefined ||
      typeof stepArgs !== 'object' ||
      Array.isArray(stepArgs) ||
      Object.keys(stepArgs).length === 0
    ) {
      return;
    }

    const baseIntent = intentAccess(targetGuid);
    if (!baseIntent) {
      this.cancel('Target intent unavailable');
      return;
    }

    mutateIntent(targetGuid, (stepArgs));
    //    mutateIntent(targetGuid, cloneRecord(stepArgs)); // Is cloning necessary here?
  }

  start(intentAccess: IntentAccessFn, mutateIntent: MutateIntentFn): void {
    this.cancelled = false;
    this._lerpRebootstrapWrapFromCycleIdx = undefined;
    this._manualModeActive = false;
    this._intentAccess = intentAccess;
    this._mutateIntent = mutateIntent;
    const rawDef = this.callbacks.getDefinitionRecord();
    if (rawDef) {
      let touched = this.ensureContentObjectOnRecord(rawDef);
      const normalized = this.normalizeStoredStepsAndRefresh();
      touched ||= normalized.changed;
      if (touched) {
        this.callbacks.onDefinitionChanged?.();
      }
    }
    const { steps, repeatLoops, cycleLengthMs, lengthClampActive, clippedByLength, parseError } =
      this.parseSteps();
    if (this.targetIntentGuids().length === 0) {
      this.callbacks.onStatus({
        status: 'stopped',
        message: { text: 'No targetIntents' },
        data: {},
      });
      return;
    }

    if (parseError === 'no_content') {
      this.callbacks.onStatus({
        status: 'stopped',
        message: { text: 'keyframeAnimator requires definition.content object' },
        data: {},
      });
      return;
    }
    if (parseError === 'invalid_length') {
      this.callbacks.onStatus({
        status: 'stopped',
        message: { text: 'keyframeAnimator requires finite content.length > 0' },
        data: {},
      });
      return;
    }

    if (steps.length === 0) {
      this.callbacks.onStatus({
        status: 'stopped',
        message: {
          text: `No steps before length boundary (${cycleLengthMs} ms)`,
        },
        data: { lengthMs: cycleLengthMs },
      });
      return;
    }

    const lerpSpec = this.parseContentLerp();
    const period = cycleLengthMs;
    const infinite = repeatLoops === 0;
    const totalCycles = infinite ? Number.POSITIVE_INFINITY : repeatLoops;

    this._runStartWall = Date.now();
    this._lastFiredCycleIdx = 0;
    this._lastFiredStepIdx = -1;

    const baseStatusParts = (): Record<string, unknown> =>
      lengthClampActive
        ? { lengthMs: period, clippedSteps: clippedByLength }
        : {};

    this.callbacks.onStatus({
      status: 'started',
      message: { text: 'Animation started' },
      data: {
        step: 0,
        total: steps.length,
        ...(lengthClampActive
          ? { lengthMs: period, clippedSteps: clippedByLength }
          : {}),
      },
    });

    // startStepIdx: skip steps already fired before a timescale-driven restart.
    const scheduleCyclePlain = (cIdx: number, startStepIdx = 0): void => {
      if (this.cancelled || !this.inScene) return;
      if (!infinite && cIdx >= totalCycles) {
        this.callbacks.onStatus({
          status: 'stopped',
          message: { text: 'Animation finished' },
          data: { cycles: cIdx, completed: true },
        });
        return;
      }

      if (cIdx >= 1) {
        const loopNum = cIdx + 1;
        this.callbacks.onStatus({
          status: 'started',
          message: { text: `loop ${loopNum}` },
          data: {
            phase: 'loop',
            cycle: loopNum,
            totalStepsThisLoop: steps.length,
            ...baseStatusParts(),
          },
        });
      }

      const L = steps.length;

      for (let i = startStepIdx; i < L; i++) {
        const step = steps[i];
        if (!step) continue;
        const fireWallAbs = this.wallFromAnimStart(cIdx * period + step.time);
        const stepIdx = i;
        const t = setTimeout(() => {
          this._lastFiredCycleIdx = cIdx;
          this._lastFiredStepIdx = stepIdx;
          this.emitOneKeyframeToAllTargets(intentAccess, mutateIntent, step.args);
        }, Math.max(0, fireWallAbs - Date.now()));
        this.timers.push(t);
      }

      const nextCycleAt = this.wallFromAnimStart((cIdx + 1) * period);
      const nextDelay = Math.max(0, nextCycleAt - Date.now());
      const nextT = setTimeout(() => {
        scheduleCyclePlain(cIdx + 1, 0);
      }, nextDelay);
      this.timers.push(nextT);
    };

    const scheduleCycleWithLerp = (lerp: {
      timeMs: number;
      quantizationEff: number;
      curveName: unknown;
      minNominalMs?: number;
    }): ((cIdx: number, startStepIdx?: number) => void) => {
      return (cIdx: number, startStepIdx = 0): void => {
        const scheduleLerpSegmentWhenWindowStarts = (
          fromIdx: number,
          toIdx: number,
          wrapToNextCycle: boolean,
          anchorCycleForPrevStep: number,
        ): void => {
          const prevStep = steps[fromIdx];
          const nextStep = steps[toIdx];
          if (!prevStep || !nextStep) return;

          const prevMsOffset = anchorCycleForPrevStep * period + prevStep.time;
          const nextMsOffset = wrapToNextCycle
            ? (anchorCycleForPrevStep + 1) * period + nextStep.time
            : anchorCycleForPrevStep * period + nextStep.time;

          const prevAnchorWallAbs = this.wallFromAnimStart(prevMsOffset);
          const nextAnchorWallAbs = this.wallFromAnimStart(nextMsOffset);

          const segmentStartMs = Math.max(
            prevAnchorWallAbs,
            nextAnchorWallAbs - lerp.timeMs * this.timescale,
          );
          const span = nextAnchorWallAbs - segmentStartMs;

          this.pushTimeoutAtFireWall(segmentStartMs, () => {
            if (this.cancelled || !this.inScene) return;

            this.forEachTarget(targetGuid => {
              const baseIntent = intentAccess(targetGuid);
              if (!baseIntent) {
                this.cancel('Target intent unavailable');
                return;
              }

              const baseRecord = baseIntent as unknown as Record<string, unknown>;
              const { from: fromResolvedRaw, to: toResolvedRaw } = lerpPlanEndpoints(
                baseRecord,
                prevStep.args,
                nextStep.args,
              );

              const planOpts: PlanIntermediateLerpOptions = {
                // onQuantizationCappedOriginalN: originalN =>
                //   Logger.warn(
                //     '[keyframeAnimator] lerp substep cap:',
                //     `${String(originalN)} → ${String(MAX_LERP_SUBSTEPS_PER_SEGMENT)}`,
                //   ),
              };
              if (typeof lerp.minNominalMs === 'number' && Number.isFinite(lerp.minNominalMs)) {
                planOpts.segmentWallSpanMs = span;
                planOpts.minGapWallMs = lerp.minNominalMs * this.timescale;
              }

              const planned = planIntermediateLerpPatches(
                fromResolvedRaw,
                toResolvedRaw,
                lerp.quantizationEff,
                lerp.curveName,
                planOpts,
              );

              if (planned.intermediateDotPatches.length === 0) {
                return;
              }

              const denom = planned.n - 1;

              for (let k = 0; k < planned.intermediateDotPatches.length; k++) {
                const dotPatch = planned.intermediateDotPatches[k];
                if (dotPatch === undefined) continue;
                const fireWallAbs = segmentStartMs + (k / denom) * span;
                const patchRecord = dotPatch as Record<string, unknown>;

                this.pushTimeoutAtFireWall(fireWallAbs, () => {
                  if (this.cancelled || !this.inScene) return;
                  if (Object.keys(patchRecord).length === 0) return;
                  mutateIntent(targetGuid, patchRecord);
                });
              }
            });
          });
        };

        if (this.cancelled || !this.inScene) return;
        if (!infinite && cIdx >= totalCycles) {
          this.callbacks.onStatus({
            status: 'stopped',
            message: { text: 'Animation finished' },
            data: { cycles: cIdx, completed: true },
          });
          return;
        }

        if (cIdx >= 1) {
          const loopNum = cIdx + 1;
          this.callbacks.onStatus({
            status: 'started',
            message: { text: `loop ${loopNum}` },
            data: {
              phase: 'loop',
              cycle: loopNum,
              totalStepsThisLoop: steps.length,
              ...baseStatusParts(),
            },
          });
        }

        const L = steps.length;

        const reboundWrap = this._lerpRebootstrapWrapFromCycleIdx;
        if (reboundWrap !== undefined) {
          this._lerpRebootstrapWrapFromCycleIdx = undefined;
          if (L >= 2) {
            scheduleLerpSegmentWhenWindowStarts(L - 1, 0, true, reboundWrap);
          }
        }

        if (startStepIdx > 0 && startStepIdx < L) {
          scheduleLerpSegmentWhenWindowStarts(startStepIdx - 1, startStepIdx, false, cIdx);
        }

        for (let i = startStepIdx; i < L; i++) {
          const step = steps[i];
          if (!step) continue;
          const fireWallAbs = this.wallFromAnimStart(cIdx * period + step.time);
          const stepIdx = i;
          this.pushTimeoutAtFireWall(fireWallAbs, () => {
            this._lastFiredCycleIdx = cIdx;
            this._lastFiredStepIdx = stepIdx;
            this.emitOneKeyframeToAllTargets(intentAccess, mutateIntent, step.args);
            if (L >= 2 && stepIdx < L - 1) {
              scheduleLerpSegmentWhenWindowStarts(stepIdx, stepIdx + 1, false, cIdx);
            } else if (L >= 2 && stepIdx === L - 1) {
              scheduleLerpSegmentWhenWindowStarts(L - 1, 0, true, cIdx);
            }
          });
        }

        const nextCycleAt = this.wallFromAnimStart((cIdx + 1) * period);
        const nextDelay = Math.max(0, nextCycleAt - Date.now());
        const nextT = setTimeout(() => {
          scheduleCycleWithLerp(lerp)(cIdx + 1, 0);
        }, nextDelay);
        this.timers.push(nextT);
      };
    };

    if (lerpSpec === null) {
      this._resumeFn = (cIdx, startStepIdx) => scheduleCyclePlain(cIdx, startStepIdx);
      scheduleCyclePlain(0, 0);
    } else {
      const runner = scheduleCycleWithLerp(lerpSpec);
      this._resumeFn = (cIdx, startStepIdx) => runner(cIdx, startStepIdx);
      runner(0, 0);
    }
  }
}
