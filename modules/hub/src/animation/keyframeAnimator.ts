import type { ControllerIntent } from '../ProjectManager';
import type { AnimationRunStatus } from '../hubStatusTypes';
import { applyDotPathPatch, cloneRecord } from '../dotPath';
import { intentToEvent } from '../handlers/intentHelpers';
import { transformIntentToNormalized } from '../intents';

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
 * Minimal keyframe runner: one renderer event per step, no interpolation.
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
  ) {}

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

  private parseSteps(): {
    steps: { time: number; args?: Record<string, unknown> }[];
    repeatLoops: number;
    cycleLengthMs: number;
    lengthClampActive: boolean;
    clippedByLength: boolean;
  } {
    const stepsRaw = this.rawDef['steps'];
    const content = this.rawDef['content'];
    const nested =
      content && typeof content === 'object' && !Array.isArray(content)
        ? (content as Record<string, unknown>)['steps']
        : undefined;
    const arr = Array.isArray(stepsRaw) ? stepsRaw : Array.isArray(nested) ? nested : [];
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

    const repeatRaw = this.rawDef['repeat'];
    const repeatLoops =
      typeof repeatRaw === 'number' && Number.isFinite(repeatRaw) && repeatRaw >= 0 ? repeatRaw : 0;

    const lenRaw = this.rawDef['length'];
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

    const period = cycleLengthMs;
    const infinite = repeatLoops === 0;
    const totalCycles = infinite ? Number.POSITIVE_INFINITY : repeatLoops;

    const startWall = Date.now();

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

    const scheduleCycle = (cIdx: number): void => {
      if (this.cancelled || !this.inScene) return;
      if (!infinite && cIdx >= totalCycles) {
        this.callbacks.onStatus({
          status: 'stopped',
          message: { text: 'Animation finished' },
          data: { cycles: cIdx },
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
            ...(lengthClampActive ? { lengthMs: period, clippedSteps: clippedByLength } : {}),
          },
        });
      }

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!step) continue;
        const fireAt = startWall + cIdx * period + step.time;
        const delay = Math.max(0, fireAt - Date.now());
        const stepIndex = i + 1;

        const t = setTimeout(() => {
          if (this.cancelled || !this.inScene) return;

          const baseIntent = intentAccess(targetGuid);
          if (!baseIntent) {
            this.cancel('Target intent unavailable');
            return;
          }

          const patched =
            step.args && Object.keys(step.args).length > 0
              ? (applyDotPathPatch(
                  cloneRecord(baseIntent as unknown as Record<string, unknown>),
                  step.args,
                  [],
                ) as unknown as ControllerIntent)
              : baseIntent;

          const normalized = transformIntentToNormalized(patched);
          const ev = intentToEvent(normalized, fireAt);

          schedule([{ event: ev, scheduledAt: fireAt }]);

          this.callbacks.onStatus({
            status: 'started',
            message: {
              text: `${totalCycles === Number.POSITIVE_INFINITY ? `${cIdx + 1}: ` : ''}step ${stepIndex} of ${steps.length}`,
            },
            data: {
              step: stepIndex,
              total: steps.length,
              cycle: cIdx + 1,
              ...(lengthClampActive ? { lengthMs: period, clippedSteps: clippedByLength } : {}),
            },
          });
        }, delay);
        this.timers.push(t);
      }

      const nextCycleAt = startWall + (cIdx + 1) * period;
      const nextDelay = Math.max(0, nextCycleAt - Date.now());
      const nextT = setTimeout(() => {
        scheduleCycle(cIdx + 1);
      }, nextDelay);
      this.timers.push(nextT);
    };

    scheduleCycle(0);
  }
}
