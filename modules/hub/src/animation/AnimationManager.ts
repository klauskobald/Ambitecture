import type { ProjectManager, ControllerIntent } from '../ProjectManager';
import type { RuntimeIntentStore } from '../RuntimeIntentStore';
import type { EventQueue } from '../EventQueue';
import { HubStatusDispatcher, type HubStatusAnimationPayload } from '../hubStatusTypes';
import { KeyframeAnimator } from './keyframeAnimator';
import { Logger } from '../Logger';

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
};

export type AnimationStatusPayload = {
  status: 'started' | 'paused' | 'stopped';
  message: { text: string };
  data: Record<string, unknown>;
};

/**
 * Hub-side orchestration: one runner per animation guid, events via {@link EventQueue},
 * status via {@link HubStatusDispatcher}.
 */
export class AnimationManager {
  private runners = new Map<string, ActiveRunner>();
  private onInternalStatus?: (guid: string, payload: AnimationStatusPayload) => void;

  constructor(
    private projectManager: ProjectManager,
    private runtimeIntentStore: RuntimeIntentStore,
    private eventQueue: EventQueue,
    private hubStatus: HubStatusDispatcher,
  ) { }

  setInternalStatusListener(cb: (guid: string, payload: AnimationStatusPayload) => void): void {
    this.onInternalStatus = cb;
  }

  private intentAccessFn(guid: string): ControllerIntent | undefined {
    const eff = this.runtimeIntentStore.getEffectiveIntent(guid);
    if (eff) return eff;
    return this.projectManager.getIntentDefinition(guid);
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
   * Finite run completed all cycles; plugin is idle — drop registration so scene re-entry does not restart it.
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
      this.unregisterNaturallyFinishedRunner(animationGuid);
    }
  }

  /**
   * Start or restart animation. Kills any existing runner for the same guid.
   */
  trigger(animationGuid: string, opts: { location?: [number, number] } = {}): void {
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
    const plugin = new KeyframeAnimator(animationGuid, record, {
      onStatus: p => {
        this.emitAnimatorStatus(animationGuid, p, opts.location);
      },
    });

    if (!inScene) {
      plugin.onSceneMembershipChanged(false);
      this.runners.set(animationGuid, {
        plugin,
        targetIntentGuid: target,
        definitionRecord: record,
        lastInScene: false,
      });
      return;
    }

    this.runners.set(animationGuid, {
      plugin,
      targetIntentGuid: target,
      definitionRecord: record,
      lastInScene: true,
    });

    const schedule = (entries: { event: object; scheduledAt: number }[]): void => {
      this.eventQueue.schedule(entries, opts.location);
    };

    plugin.start(g => this.intentAccessFn(g), schedule);
  }

  private stopRunner(animationGuid: string, reason: string): void {
    const existing = this.runners.get(animationGuid);
    if (existing) {
      existing.plugin.cancel(reason);
      this.runners.delete(animationGuid);
    }
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
        runner.plugin.onSceneMembershipChanged(false);
        continue;
      }

      // Re-enter active scene: restart from cycle 0 for runners still registered (paused mid-run or infinite).
      runner.plugin.stripTimers();
      const record = runner.definitionRecord;
      const fresh = new KeyframeAnimator(guid, record, {
        onStatus: p => this.emitAnimatorStatus(guid, p, location),
      });
      this.runners.set(guid, {
        plugin: fresh,
        targetIntentGuid: runner.targetIntentGuid,
        definitionRecord: record,
        lastInScene: true,
      });
      fresh.start(
        g => this.intentAccessFn(g),
        entries => this.eventQueue.schedule(entries, location),
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
