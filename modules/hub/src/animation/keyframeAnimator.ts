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
 * eased ramps between successive keyframes. Keyframe knobs (`repeat`, `length`, `steps`, `lerp`) live in
 * `definition.content`, or legacy root-level if `content` is omitted.
 *
 * Optional `length` (seconds, stored in config): converted to ms internally; one loop spans `[0, length×1000)` — steps at `time >= length×1000` stay dormant until length is raised.
 * If `length` is omitted, cycle length equals the largest step `time` (legacy).
 * With `content.lerp`, each segment’s substeps are scheduled individually via `pushTimeoutAtFireWall` when that segment’s lerp window starts, not as a single batch for the whole loop.
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

  // ── edit mode (controller-driven keyframe stepping) ───────────────────────
  private editActive = false;
  private editBindingKey?: string;
  private editBindingMgr?: BindingManager;
  private editIntentAccess?: IntentAccessFn;
  private editMutateIntent?: MutateIntentFn;
  private editTargetGuid?: string;
  private editSteps: { time: number; args?: Record<string, unknown> }[] = [];
  private editIndex = 0;

  constructor(
    private animationGuid: string,
    private rawDef: Record<string, unknown>,
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
    this.stripTimers();
    this._resumeFn(this._lastFiredCycleIdx, this._lastFiredStepIdx + 1);
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
  }): void {
    if (this.editActive) return;

    const { steps } = this.parseSteps();
    const targetGuid = this.targetIntentGuid();

    if (!targetGuid) {
      this.callbacks.onStatus({
        status: 'stopped',
        message: { text: 'No targetIntent (edit aborted)' },
        data: {},
      });
      return;
    }
    if (steps.length === 0) {
      this.callbacks.onStatus({
        status: 'stopped',
        message: { text: 'No keyframe steps to edit' },
        data: {},
      });
      return;
    }

    this.editActive = true;
    this.editIntentAccess = deps.intentAccess;
    this.editMutateIntent = deps.mutateIntent;
    this.editBindingMgr = deps.bindingManager;
    this.editBindingKey = `${this.animationGuid}-editState`;
    this.editTargetGuid = targetGuid;
    this.editSteps = steps;
    this.editIndex = 0;

    this.emitCurrentEditStep();

    deps.bindingManager.registerMaster(
      this.editBindingKey,
      () => this.computeEditState(),
      value => this.applyEditState(value),
    );
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
    delete this.editTargetGuid;
    this.editSteps = [];
    this.editIndex = 0;
  }

  private computeEditState(): {
    totalSteps: number;
    currentStepIndex: number;
    currentStepContent: unknown;
  } {
    const total = this.editSteps.length;
    const idx = total > 0 ? Math.max(0, Math.min(total - 1, this.editIndex)) : 0;
    const step = this.editSteps[idx];
    return {
      totalSteps: total,
      currentStepIndex: idx,
      currentStepContent: step ?? null,
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
    if (this.editBindingMgr && this.editBindingKey) {
      this.editBindingMgr.receiveFromMaster(this.editBindingKey, this.computeEditState());
    }
  }

  private emitCurrentEditStep(): void {
    if (!this.editTargetGuid || !this.editIntentAccess || !this.editMutateIntent) return;
    const step = this.editSteps[this.editIndex];
    if (!step) return;
    this.emitOneKeyframe(this.editTargetGuid, this.editIntentAccess, this.editMutateIntent, step.args);
  }

  /**
   * Keyframe fields live in `content` when present; otherwise root-level repeat/length/steps (legacy).
   */
  private keyframeConfigBag(): Record<string, unknown> {
    const raw = this.rawDef as Record<string, unknown>;
    const content = raw['content'];
    if (
      content !== undefined &&
      typeof content === 'object' &&
      content !== null &&
      !Array.isArray(content)
    ) {
      return content as Record<string, unknown>;
    }
    return raw;
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
    repeatLoops: number;
    cycleLengthMs: number;
    lengthClampActive: boolean;
    clippedByLength: boolean;
  } {
    const cfg = this.keyframeConfigBag();
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
    const sorted = parsed
      .sort((a, b) => (a.time === b.time ? a._index - b._index : a.time - b.time))
      .map(p => (p.args !== undefined ? { time: p.time, args: p.args } : { time: p.time }));

    const repeatRaw = cfg['repeat'];
    const repeatLoops =
      typeof repeatRaw === 'number' && Number.isFinite(repeatRaw) && repeatRaw >= 0 ? repeatRaw : 0;

    const lenRaw = cfg['length'];
    const lengthMs =
      typeof lenRaw === 'number' && Number.isFinite(lenRaw) && lenRaw > 0 ? lenRaw * 1000 : undefined;

    if (lengthMs === undefined) {
      const fallbackPeriod = sorted.length === 0 ? 1 : Math.max(...sorted.map(s => s.time), 1);
      return {
        steps: sorted,
        repeatLoops,
        cycleLengthMs: fallbackPeriod,
        lengthClampActive: false,
        clippedByLength: false,
      };
    }

    const steps = sorted.filter(s => s.time < lengthMs);
    const cycleLengthMs = lengthMs;

    return {
      steps,
      repeatLoops,
      cycleLengthMs,
      lengthClampActive: true,
      clippedByLength: sorted.length > steps.length,
    };
  }

  private targetIntentGuid(): string | undefined {
    const a = this.rawDef['targetIntent'];
    const b = this.rawDef['intent'];
    if (typeof a === 'string' && a.length > 0) return a;
    if (typeof b === 'string' && b.length > 0) return b;
    return undefined;
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
    const { steps, repeatLoops, cycleLengthMs, lengthClampActive, clippedByLength } =
      this.parseSteps();
    const targetGuid = this.targetIntentGuid();
    if (!targetGuid) {
      this.callbacks.onStatus({
        status: 'stopped',
        message: { text: 'No targetIntent' },
        data: {},
      });
      return;
    }

    if (steps.length === 0) {
      this.callbacks.onStatus({
        status: 'stopped',
        message: {
          text: lengthClampActive
            ? `No steps before length boundary (${cycleLengthMs} ms)`
            : 'No keyframe steps',
        },
        data:
          lengthClampActive
            ? { lengthMs: cycleLengthMs }
            : {},
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
          this.emitOneKeyframe(targetGuid, intentAccess, mutateIntent, step.args);
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
        ): void => {
          const prevStep = steps[fromIdx];
          const nextStep = steps[toIdx];
          if (!prevStep || !nextStep) return;

          const prevMsOffset = cIdx * period + prevStep.time;
          const nextMsOffset = wrapToNextCycle
            ? (cIdx + 1) * period + nextStep.time
            : cIdx * period + nextStep.time;

          const prevAnchorWallAbs = this.wallFromAnimStart(prevMsOffset);
          const nextAnchorWallAbs = this.wallFromAnimStart(nextMsOffset);

          const segmentStartMs = Math.max(
            prevAnchorWallAbs,
            nextAnchorWallAbs - lerp.timeMs * this.timescale,
          );
          const span = nextAnchorWallAbs - segmentStartMs;

          this.pushTimeoutAtFireWall(segmentStartMs, () => {
            if (this.cancelled || !this.inScene) return;

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
              onQuantizationCappedOriginalN: originalN =>
                Logger.warn(
                  '[keyframeAnimator] lerp substep cap:',
                  `${String(originalN)} → ${String(MAX_LERP_SUBSTEPS_PER_SEGMENT)}`,
                ),
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
                mutateIntent(targetGuid, (patchRecord));
                //                mutateIntent(targetGuid, cloneRecord(patchRecord)); // Is cloning necessary here?
              });
            }
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

        // On restart, skip lerp segments before startStepIdx; always schedule wrap segment.
        for (let i = startStepIdx; i < L - 1; i++) {
          scheduleLerpSegmentWhenWindowStarts(i, i + 1, false);
        }
        if (L >= 2) {
          scheduleLerpSegmentWhenWindowStarts(L - 1, 0, true);
        }

        for (let i = startStepIdx; i < L; i++) {
          const step = steps[i];
          if (!step) continue;
          const fireWallAbs = this.wallFromAnimStart(cIdx * period + step.time);
          const stepIdx = i;
          this.pushTimeoutAtFireWall(fireWallAbs, () => {
            this._lastFiredCycleIdx = cIdx;
            this._lastFiredStepIdx = stepIdx;
            this.emitOneKeyframe(targetGuid, intentAccess, mutateIntent, step.args);
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
