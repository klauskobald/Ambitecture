import type { ControllerIntent } from '../ProjectManager';
import type { AnimationRunStatus } from '../hubStatusTypes';
import { Logger } from '../Logger';
import { applyDotPathPatch, cloneRecord } from '../dotPath';
import { intentToEvent } from '../handlers/intentHelpers';
import { transformIntentToNormalized } from '../intents';

import {
  MAX_LERP_SUBSTEPS_PER_SEGMENT,
  effectiveLerpQuantization,
  planIntermediateLerpPatches,
} from './paramLerpSchedule';

export type IntentAccessFn = (guid: string) => ControllerIntent | undefined;

export interface KeyframeScheduleEntry {
  event: object;
  scheduledAt: number;
}

export interface KeyframeAnimatorCallbacks {
  onStatus: (payload: {
    status: AnimationRunStatus;
    message: { text: string };
    data: Record<string, unknown>;
  }) => void;
}

/**
 * Keyframe runner: one renderer event per step by default; optional `content.lerp` adds quantized
 * eased ramps between successive keyframes. Keyframe knobs (`repeat`, `length`, `steps`, `lerp`) live in
 * `definition.content`, or legacy root-level if `content` is omitted.
 *
 * Optional `length` (ms): one loop spans `[0, length)` — steps at `time >= length` stay dormant until length is raised.
 * If `length` is omitted, cycle length equals the largest step `time` (legacy).
 * On target intent leaving active scene: pause (clear timers). Re-enter: restart from cycle 0 (v1).
 */
export class KeyframeAnimator {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private cancelled = false;
  private inScene = true;

  constructor(
    _animationGuid: string,
    private rawDef: Record<string, unknown>,
    private callbacks: KeyframeAnimatorCallbacks,
  ) { }

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

  /** Optional `content.lerp`: quantized eased substitution toward the next anchor; omit or disable when `time` ≤ 0. */
  private parseContentLerp():
    | {
      timeMs: number;
      quantizationEff: number;
      curveName: unknown;
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
    return {
      timeMs: timeRaw,
      quantizationEff: effectiveLerpQuantization(lr['quantization']),
      curveName: lr['curve'],
    };
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
      const time = Number(row['time']);
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
      typeof lenRaw === 'number' && Number.isFinite(lenRaw) && lenRaw > 0 ? lenRaw : undefined;

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
    fireWallAbs: number,
    targetGuid: string,
    intentAccess: IntentAccessFn,
    schedule: (entries: KeyframeScheduleEntry[]) => void,
    stepArgs: Record<string, unknown> | undefined,
    statusLine: string,
    statusData: Record<string, unknown>,
  ): void {
    if (this.cancelled || !this.inScene) return;

    const baseIntent = intentAccess(targetGuid);
    if (!baseIntent) {
      this.cancel('Target intent unavailable');
      return;
    }

    const patched =
      stepArgs && Object.keys(stepArgs).length > 0
        ? (applyDotPathPatch(
          cloneRecord(baseIntent as unknown as Record<string, unknown>),
          stepArgs,
          [],
        ) as unknown as ControllerIntent)
        : baseIntent;

    const normalized = transformIntentToNormalized(patched);
    const ev = intentToEvent(normalized, fireWallAbs);

    schedule([{ event: ev, scheduledAt: fireWallAbs }]);

    this.callbacks.onStatus({
      status: 'started',
      message: { text: statusLine },
      data: statusData,
    });
  }

  start(intentAccess: IntentAccessFn, schedule: (entries: KeyframeScheduleEntry[]) => void): void {
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

    const startWall = Date.now();

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

    const scheduleCyclePlain = (cIdx: number): void => {
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

      for (let i = 0; i < L; i++) {
        const step = steps[i];
        if (!step) continue;
        const fireWallAbs = startWall + cIdx * period + step.time;
        const stepIndex = i + 1;

        const t = setTimeout(() => {
          const statusLine =
            `${totalCycles === Number.POSITIVE_INFINITY ? `${cIdx + 1}: ` : ''}step ${stepIndex} of ${L}`;
          this.emitOneKeyframe(fireWallAbs, targetGuid, intentAccess, schedule, step.args, statusLine, {
            step: stepIndex,
            total: L,
            cycle: cIdx + 1,
            ...baseStatusParts(),
          });
        }, Math.max(0, fireWallAbs - Date.now()));
        this.timers.push(t);
      }

      const nextCycleAt = startWall + (cIdx + 1) * period;
      const nextDelay = Math.max(0, nextCycleAt - Date.now());
      const nextT = setTimeout(() => {
        scheduleCyclePlain(cIdx + 1);
      }, nextDelay);
      this.timers.push(nextT);
    };

    const scheduleCycleWithLerp = (lerp: { timeMs: number; quantizationEff: number; curveName: unknown }): ((cIdx: number) => void) => {
      return (cIdx: number): void => {
        const appendLerpSegmentEntries = (
          batch: KeyframeScheduleEntry[],
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

          const prevAnchorWallAbs = startWall + prevMsOffset;
          const nextAnchorWallAbs = startWall + nextMsOffset;

          /** Overlap clamp: substeps in `[next - lerp.time, next]` vs cycle wall; start `max(prev anchor, next - lerp.time)`. */
          const segmentStartMs = Math.max(prevAnchorWallAbs, nextAnchorWallAbs - lerp.timeMs);

          const baseIntent = intentAccess(targetGuid);
          if (!baseIntent) return;

          const fromResolvedRaw =
            prevStep.args !== undefined &&
              typeof prevStep.args === 'object' &&
              Array.isArray(prevStep.args) === false &&
              Object.keys(prevStep.args).length > 0
              ? applyDotPathPatch(
                cloneRecord(baseIntent as unknown as Record<string, unknown>),
                prevStep.args,
                [],
              )
              : (baseIntent as unknown as Record<string, unknown>);

          const nextArgs = nextStep.args;
          const toResolvedRaw =
            nextArgs !== undefined && Object.keys(nextArgs).length > 0
              ? applyDotPathPatch(
                cloneRecord(baseIntent as unknown as Record<string, unknown>),
                nextArgs,
                [],
              )
              : (baseIntent as unknown as Record<string, unknown>);

          const planned = planIntermediateLerpPatches(
            fromResolvedRaw,
            toResolvedRaw,
            lerp.quantizationEff,
            lerp.curveName,
            originalN =>
              Logger.warn(
                '[keyframeAnimator] lerp substep cap:',
                `${String(originalN)} → ${String(MAX_LERP_SUBSTEPS_PER_SEGMENT)}`,
              ),
          );

          if (planned.intermediateDotPatches.length === 0) {
            return;
          }

          const span = nextAnchorWallAbs - segmentStartMs;
          const denom = planned.n - 1;
          const fromBaseline = cloneRecord(fromResolvedRaw);

          for (let k = 0; k < planned.intermediateDotPatches.length; k++) {
            const dotPatch = planned.intermediateDotPatches[k];
            if (dotPatch === undefined) continue;
            const fireWallAbs = segmentStartMs + (k / denom) * span;
            const patchRecord = dotPatch as Record<string, unknown>;

            const patchedRecord =
              Object.keys(patchRecord).length > 0
                ? applyDotPathPatch(cloneRecord(fromBaseline), patchRecord, [])
                : cloneRecord(fromBaseline);

            const patched = patchedRecord as unknown as ControllerIntent;
            const normalized = transformIntentToNormalized(patched);
            const ev = intentToEvent(normalized, fireWallAbs);
            batch.push({ event: ev, scheduledAt: fireWallAbs });
          }
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

        const lerpEntriesThisCycle: KeyframeScheduleEntry[] = [];
        for (let i = 0; i < L - 1; i++) {
          appendLerpSegmentEntries(lerpEntriesThisCycle, i, i + 1, false);
        }
        if (L >= 2) {
          appendLerpSegmentEntries(lerpEntriesThisCycle, L - 1, 0, true);
        }
        if (lerpEntriesThisCycle.length > 0) {
          schedule(lerpEntriesThisCycle);
        }

        for (let i = 0; i < L; i++) {
          const step = steps[i];
          if (!step) continue;
          const fireWallAbs = startWall + cIdx * period + step.time;
          const stepIndex = i + 1;

          this.pushTimeoutAtFireWall(fireWallAbs, () => {
            const statusLine =
              `${totalCycles === Number.POSITIVE_INFINITY ? `${cIdx + 1}: ` : ''}step ${stepIndex} of ${L}`;
            this.emitOneKeyframe(fireWallAbs, targetGuid, intentAccess, schedule, step.args, statusLine, {
              step: stepIndex,
              total: L,
              cycle: cIdx + 1,
              ...baseStatusParts(),
            });
          });
        }

        const nextCycleAt = startWall + (cIdx + 1) * period;
        const nextDelay = Math.max(0, nextCycleAt - Date.now());
        const nextT = setTimeout(() => {
          scheduleCycleWithLerp(lerp)(cIdx + 1);
        }, nextDelay);
        this.timers.push(nextT);
      };
    };

    if (lerpSpec === null) {
      scheduleCyclePlain(0);
    } else {
      const runner = scheduleCycleWithLerp(lerpSpec);
      runner(0);
    }
  }
}
