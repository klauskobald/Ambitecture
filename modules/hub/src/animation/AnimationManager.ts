import type { ProjectManager, ControllerIntent } from '../ProjectManager';
import type { RuntimeIntentStore } from '../RuntimeIntentStore';
import type { EventQueue } from '../EventQueue';
import type { RuntimeUpdateDispatcher } from '../RuntimeUpdateDispatcher';
import { HubStatusDispatcher, type HubStatusAnimationPayload } from '../hubStatusTypes';
import { KeyframeAnimator } from './keyframeAnimator';
import { Logger } from '../Logger';
import { cloneRecord } from '../dotPath';
import { transformIntentToNormalized } from '../intents';
import type { RuntimeUpdate } from '../RuntimeProtocol';
/**
 * Companion runner actions share the animation row's guid (`action:trigger` passes that guid).
 */
export function companionActionGuid(animationGuid: string): string {
  return animationGuid;
}

type ActiveRunner = {
  plugin: KeyframeAnimator;
  targetIntentGuid: string;
  definitionRecord: Record<string, unknown>;
  lastInScene: boolean;
  timescale: number;
  intentLockHeld: boolean;
  lastLocation?: [number, number];
  /** Normalized effective intent at lock/`start`; restored via `runtime:update` when the run ends. */
  preAnimationIntentValue?: Record<string, unknown>;
};

export type AnimationStatusPayload = {
  status: 'started' | 'paused' | 'stopped';
  message: { text: string };
  data: Record<string, unknown>;
};

/**
 * Hub-side orchestration: one runner per animation guid, events via {@link EventQueue},
 * status via {@link HubStatusDispatcher}, controller lock via {@link HubStatusDispatcher.broadcastIntentLock},
 * pre-run intent snapshot restored via {@link RuntimeUpdateDispatcher.dispatch} when the run ends.
 */
export class AnimationManager {
  private runners = new Map<string, ActiveRunner>();
  private onInternalStatus?: (guid: string, payload: AnimationStatusPayload) => void;

  constructor(
    private projectManager: ProjectManager,
    private runtimeIntentStore: RuntimeIntentStore,
    private eventQueue: EventQueue,
    private hubStatus: HubStatusDispatcher,
    private runtimeUpdateDispatcher: RuntimeUpdateDispatcher,
  ) { }

  setInternalStatusListener(cb: (guid: string, payload: AnimationStatusPayload) => void): void {
    this.onInternalStatus = cb;
  }

  private intentAccessFn(guid: string): ControllerIntent | undefined {
    const eff = this.runtimeIntentStore.getEffectiveIntent(guid);
    if (eff) return eff;
    return this.projectManager.getIntentDefinition(guid);
  }

  /** Captured before `animation-started` / `plugin.start` (hub effective intent, normalized). */
  private capturePreAnimationNormalizedSnapshot(targetIntentGuid: string): Record<string, unknown> | undefined {
    const eff = this.intentAccessFn(targetIntentGuid);
    if (eff === undefined) {
      return undefined;
    }
    return cloneRecord(transformIntentToNormalized(eff) as unknown as Record<string, unknown>);
  }

  private pushAnimationStatus(
    animationGuid: string,
    payload: AnimationStatusPayload,
    location?: [number, number],
  ): void {
    const out: HubStatusAnimationPayload = {
      kind: 'animation',
      animationGuid,
      status: payload.status,
      message: payload.message,
      data: payload.data,
    };
    this.hubStatus.broadcastAnimationStatus(out, location);
    this.onInternalStatus?.(animationGuid, payload);
  }

  /**
   * Finite run completed all cycles; plugin is idle — drop registration so scene re-enter does not restart it.
   */
  private unregisterNaturallyFinishedRunner(animationGuid: string): void {
    if (!this.runners.has(animationGuid)) return;
    this.runners.delete(animationGuid);
  }

  private emitAnimatorStatus(
    animationGuid: string,
    payload: AnimationStatusPayload,
    location?: [number, number],
  ): void {
    this.pushAnimationStatus(animationGuid, payload, location);
    if (
      payload.status === 'stopped' &&
      payload.data['completed'] === true
    ) {
      const runner = this.runners.get(animationGuid);
      if (runner !== undefined) {
        this.finalizeAnimatedIntent(runner, location ?? runner.lastLocation);
      }
      this.unregisterNaturallyFinishedRunner(animationGuid);
    }
  }

  /**
   * Restore pre-run intent via `runtime:update` (+ renderer `events`), then `lock:intent` `animation-stopped`.
   */
  private finalizeAnimatedIntent(runner: ActiveRunner, location?: [number, number]): void {
    const loc = location ?? runner.lastLocation;
    const baseline = runner.preAnimationIntentValue;
    if (baseline !== undefined) {
      const update: RuntimeUpdate = {
        entityType: 'intent',
        guid: runner.targetIntentGuid,
        source: 'hub:animation',
        value: cloneRecord(baseline),
      };
      this.runtimeUpdateDispatcher.dispatch([update], loc, Date.now());
    }

    if (runner.intentLockHeld) {
      this.hubStatus.broadcastIntentLock(
        { guid: runner.targetIntentGuid, reason: 'animation-stopped' },
        loc,
      );
      runner.intentLockHeld = false;
    }
  }

  /**
   * Start or restart animation. Kills any existing runner for the same guid.
   */
  trigger(animationGuid: string, opts: { location?: [number, number]; timescale?: number } = {}): void {
    const def = this.projectManager.getAnimationByGuid(animationGuid);
    if (!def) {
      Logger.warn(`[animation] unknown animation ${animationGuid}`);
      return;
    }

    const record = def as unknown as Record<string, unknown>;
    const animClass = typeof record['class'] === 'string' ? record['class'] : '';
    if (animClass !== 'keyframeAnimator') {
      Logger.warn(`[animation] unsupported class "${animClass}" for ${animationGuid}`);
      return;
    }

    const target =
      (typeof record['targetIntent'] === 'string' && record['targetIntent'].length > 0)
        ? record['targetIntent']
        : (typeof record['intent'] === 'string' ? record['intent'] : undefined);
    if (!target) {
      Logger.warn(`[animation] missing targetIntent for ${animationGuid}`);
      return;
    }

    this.stopRunner(animationGuid, 'replaced');

    const inScene = this.projectManager.isIntentInActiveScene(target);
    let effectiveTimescale = 1;
    if (opts.timescale !== undefined) {
      if (typeof opts.timescale !== 'number' || !Number.isFinite(opts.timescale) || opts.timescale <= 0) {
        Logger.warn('[animation] trigger ignored opts.timescale — need finite factor > 0:', opts.timescale);
      } else {
        effectiveTimescale = opts.timescale;
      }
    }

    const plugin = new KeyframeAnimator(animationGuid, record, {
      onStatus: p => {
        this.emitAnimatorStatus(animationGuid, p, opts.location ?? this.runners.get(animationGuid)?.lastLocation);
      },
    });
    plugin.setTimescale(effectiveTimescale);

    const preSnap = inScene ? this.capturePreAnimationNormalizedSnapshot(target) : undefined;

    const runnerBase: ActiveRunner = {
      plugin,
      targetIntentGuid: target,
      definitionRecord: record,
      lastInScene: inScene,
      timescale: effectiveTimescale,
      intentLockHeld: false,
      ...(opts.location !== undefined ? { lastLocation: opts.location } : {}),
      ...(preSnap !== undefined ? { preAnimationIntentValue: preSnap } : {}),
    };

    if (!inScene) {
      plugin.onSceneMembershipChanged(false);
      this.runners.set(animationGuid, runnerBase);
      return;
    }

    this.runners.set(animationGuid, runnerBase);
    this.hubStatus.broadcastIntentLock({ guid: target, reason: 'animation-started' }, opts.location);
    runnerBase.intentLockHeld = true;

    const schedule = (entries: { event: object; scheduledAt: number }[]): void => {
      this.eventQueue.schedule(entries, opts.location);
    };

    plugin.start(g => this.intentAccessFn(g), schedule);
  }

  /** Mid-run playback factor; timeouts already queued keep old delays until they fire (V1). */
  setTimescale(animationGuid: string, factor: number): void {
    if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) {
      Logger.warn('[animation] setTimescale ignored — need finite factor > 0:', factor);
      return;
    }
    const runner = this.runners.get(animationGuid);
    if (!runner) {
      Logger.warn(`[animation] setTimescale ignored — no runner for ${animationGuid}`);
      return;
    }
    runner.timescale = factor;
    runner.plugin.setTimescale(factor);
  }

  private stopRunner(animationGuid: string, reason: string): void {
    const existing = this.runners.get(animationGuid);
    if (!existing) {
      return;
    }
    this.finalizeAnimatedIntent(existing, existing.lastLocation);
    existing.plugin.cancel(reason);
    this.runners.delete(animationGuid);
  }

  /** Call when project unloads or hub shuts down. */
  stopAll(reason = 'hub stopped'): void {
    for (const g of [...this.runners.keys()]) {
      this.stopRunner(g, reason);
    }
  }

  /**
   * After graph commands / scene changes: update membership for running animations.
   */
  notifyActiveSceneIntentMembershipChanged(location?: [number, number]): void {
    for (const [guid, runner] of [...this.runners]) {
      const now = this.projectManager.isIntentInActiveScene(runner.targetIntentGuid);
      const prev = runner.lastInScene;
      if (prev === now) {
        continue;
      }
      runner.lastInScene = now;

      if (!now) {
        // Pause: restore pre-animation snapshot + unlock (overlay chrome).
        if (runner.lastLocation === undefined && location !== undefined) {
          runner.lastLocation = location;
        }
        this.finalizeAnimatedIntent(runner, runner.lastLocation ?? location);
        runner.plugin.onSceneMembershipChanged(false);
        continue;
      }

      runner.plugin.stripTimers();
      const record = runner.definitionRecord;
      const fresh = new KeyframeAnimator(guid, record, {
        onStatus: p =>
          this.emitAnimatorStatus(guid, p, location ?? this.runners.get(guid)?.lastLocation),
      });
      fresh.setTimescale(runner.timescale);

      const nextLocation = location ?? runner.lastLocation;
      const preReenter = this.capturePreAnimationNormalizedSnapshot(runner.targetIntentGuid);
      const next: ActiveRunner = {
        plugin: fresh,
        targetIntentGuid: runner.targetIntentGuid,
        definitionRecord: record,
        lastInScene: true,
        timescale: runner.timescale,
        intentLockHeld: false,
        ...(nextLocation !== undefined ? { lastLocation: nextLocation } : {}),
        ...(preReenter !== undefined ? { preAnimationIntentValue: preReenter } : {}),
      };
      this.runners.set(guid, next);

      this.hubStatus.broadcastIntentLock({ guid: next.targetIntentGuid, reason: 'animation-started' }, next.lastLocation);
      next.intentLockHeld = true;

      fresh.start(
        g => this.intentAccessFn(g),
        entries => this.eventQueue.schedule(entries, next.lastLocation ?? location),
      );
    }
  }

  /** When an intent row is removed from the project, stop animations targeting it. */
  onIntentRemovedFromProject(intentGuid: string): void {
    for (const [guid, runner] of [...this.runners]) {
      if (runner.targetIntentGuid === intentGuid) {
        this.stopRunner(guid, 'target intent removed');
      }
    }
  }

  /** Stop runner when animation definition is removed from the project graph. */
  onAnimationRemoved(animationGuid: string, _location?: [number, number]): void {
    this.stopRunner(animationGuid, 'animation removed');
  }
}
