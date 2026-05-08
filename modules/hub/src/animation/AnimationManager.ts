import type { ProjectManager, ControllerIntent } from '../ProjectManager';
import type { RuntimeIntentStore } from '../RuntimeIntentStore';
import type { RuntimeUpdateDispatcher } from '../RuntimeUpdateDispatcher';
import { HubStatusDispatcher, type HubStatusAnimationPayload } from '../hubStatusTypes';
import { KeyframeAnimator, type MutateIntentFn } from './keyframeAnimator';
import { Logger } from '../Logger';
import type { RuntimeUpdate } from '../RuntimeProtocol';
import type { BindingManager } from '../BindingManager';
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
  lastLocation?: [number, number];
};

export type AnimationStatusPayload = {
  status: 'started' | 'paused' | 'stopped';
  message: { text: string };
  data: Record<string, unknown>;
};

/**
 * Hub-side orchestration: one runner per animation guid. Each step mutates the runtime intent
 * via {@link RuntimeUpdateDispatcher.dispatch}, feeding the normal pipeline (renderers + controllers).
 * Status is broadcast via {@link HubStatusDispatcher}.
 */
export class AnimationManager {
  private runners = new Map<string, ActiveRunner>();
  /**
   * Animations currently in keyframe-stepping edit mode. Disjoint from {@link runners} —
   * `enterEditMode` always stops the runner first; `trigger` always exits edit first.
   * Type narrowed to KeyframeAnimator since it is currently the only class with edit support;
   * widen if/when another animator class implements its own edit lifecycle.
   */
  private edits = new Map<string, KeyframeAnimator>();
  private onInternalStatus?: (guid: string, payload: AnimationStatusPayload) => void;

  constructor(
    private projectManager: ProjectManager,
    private runtimeIntentStore: RuntimeIntentStore,
    private hubStatus: HubStatusDispatcher,
    private runtimeUpdateDispatcher: RuntimeUpdateDispatcher,
    private bindingManager?: BindingManager,
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
      this.unregisterNaturallyFinishedRunner(animationGuid);
    }
  }

  /**
   * Start or restart animation. Kills any existing runner for the same guid.
   * If the animation is in edit mode, that mode exits first.
   */
  trigger(animationGuid: string, opts: { location?: [number, number]; timescale?: number } = {}): void {
    if (this.edits.has(animationGuid)) {
      this.exitEditMode(animationGuid);
    }
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
    } else {
      const savedTs = typeof record['timescale'] === 'number' ? record['timescale'] : undefined;
      if (savedTs !== undefined && Number.isFinite(savedTs) && savedTs > 0) {
        effectiveTimescale = savedTs;
      }
    }

    const plugin = new KeyframeAnimator(animationGuid, record, {
      onStatus: p => {
        this.emitAnimatorStatus(animationGuid, p, opts.location ?? this.runners.get(animationGuid)?.lastLocation);
      },
      onDefinitionChanged: () => this.projectManager.touchAnimations(),
    });
    plugin.setTimescale(effectiveTimescale);

    const runnerBase: ActiveRunner = {
      plugin,
      targetIntentGuid: target,
      definitionRecord: record,
      lastInScene: inScene,
      timescale: effectiveTimescale,
      ...(opts.location !== undefined ? { lastLocation: opts.location } : {}),
    };

    if (!inScene) {
      plugin.onSceneMembershipChanged(false);
      this.runners.set(animationGuid, runnerBase);
      return;
    }

    this.runners.set(animationGuid, runnerBase);

    const runner = runnerBase;
    this.bindingManager?.registerMaster(
      `${animationGuid}-timescale`,
      () => runner.timescale,
      value => this.setTimescale(animationGuid, Number(value)),
    );

    const mutateIntent: MutateIntentFn = (guid, patch) => {
      if (Object.keys(patch).length === 0) return;
      const update: RuntimeUpdate = { entityType: 'intent', guid, patch, source: 'hub:animation' };
      this.runtimeUpdateDispatcher.dispatch([update], opts.location, Date.now());
    };

    plugin.start(g => this.intentAccessFn(g), mutateIntent);
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
    this.bindingManager?.receiveFromMaster(`${animationGuid}-timescale`, runner.timescale);
    this.projectManager.patchAnimationFields(animationGuid, { timescale: factor });
  }

  /** Stop playback (`action:trigger` {@code args.command: "stop"}). */
  stop(animationGuid: string, opts?: { location?: [number, number] }): void {
    const existing = this.runners.get(animationGuid);
    if (!existing) {
      Logger.warn(`[animation] stop ignored — no runner for ${animationGuid}`);
      return;
    }
    if (opts?.location !== undefined) {
      existing.lastLocation = opts.location;
    }
    this.stopRunner(animationGuid, 'action: stop');
  }

  /** Pause playback (`action:trigger` {@code args.command: "pause"}). V1 clears timers same as {@link stop}. */
  pause(animationGuid: string, opts?: { location?: [number, number] }): void {
    const existing = this.runners.get(animationGuid);
    if (!existing) {
      Logger.warn(`[animation] pause ignored — no runner for ${animationGuid}`);
      return;
    }
    if (opts?.location !== undefined) {
      existing.lastLocation = opts.location;
    }
    this.stopRunner(animationGuid, 'action: paused');
  }

  private stopRunner(animationGuid: string, reason: string): void {
    const existing = this.runners.get(animationGuid);
    if (!existing) {
      return;
    }
    this.bindingManager?.unregisterMaster(`${animationGuid}-timescale`);
    existing.plugin.cancel(reason);
    this.runners.delete(animationGuid);
  }

  /** Call when project unloads or hub shuts down. */
  stopAll(reason = 'hub stopped'): void {
    for (const g of [...this.runners.keys()]) {
      this.stopRunner(g, reason);
    }
    for (const g of [...this.edits.keys()]) {
      this.exitEditMode(g);
    }
  }

  /**
   * Enter live keyframe-stepping edit mode for `animationGuid`.
   * Stops any active runner, instantiates the animator, and hands it the BindingManager so the
   * animator can register its own master binding(s). The shape and key are entirely the animator's
   * concern — this method does not touch editState.
   */
  enterEditMode(animationGuid: string, opts: { location?: [number, number] } = {}): void {
    if (!this.bindingManager) {
      Logger.warn('[animation] enterEditMode ignored — no BindingManager');
      return;
    }
    if (this.edits.has(animationGuid)) {
      return;
    }

    const def = this.projectManager.getAnimationByGuid(animationGuid);
    if (!def) {
      Logger.warn(`[animation] enterEditMode ignored — unknown animation ${animationGuid}`);
      return;
    }
    const record = def as unknown as Record<string, unknown>;
    const animClass = typeof record['class'] === 'string' ? record['class'] : '';
    if (animClass !== 'keyframeAnimator') {
      Logger.warn(`[animation] enterEditMode unsupported class "${animClass}" for ${animationGuid}`);
      return;
    }

    if (this.runners.has(animationGuid)) {
      this.stopRunner(animationGuid, 'replaced by edit');
    }

    const plugin = new KeyframeAnimator(animationGuid, record, {
      onStatus: p => {
        this.emitAnimatorStatus(animationGuid, p, opts.location);
      },
      onDefinitionChanged: () => this.projectManager.touchAnimations(),
    });

    const mutateIntent: MutateIntentFn = (guid, patch) => {
      if (Object.keys(patch).length === 0) return;
      const update: RuntimeUpdate = { entityType: 'intent', guid, patch, source: 'hub:animation' };
      this.runtimeUpdateDispatcher.dispatch([update], opts.location, Date.now());
    };

    plugin.enterEditMode({
      intentAccess: g => this.intentAccessFn(g),
      mutateIntent,
      bindingManager: this.bindingManager,
    });

    this.edits.set(animationGuid, plugin);
  }

  /** Exit edit mode for `animationGuid`. The animator unregisters its own bindings. */
  exitEditMode(animationGuid: string): void {
    const plugin = this.edits.get(animationGuid);
    if (!plugin) return;
    plugin.exitEditMode();
    this.edits.delete(animationGuid);
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
        if (runner.lastLocation === undefined && location !== undefined) {
          runner.lastLocation = location;
        }
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
      const next: ActiveRunner = {
        plugin: fresh,
        targetIntentGuid: runner.targetIntentGuid,
        definitionRecord: record,
        lastInScene: true,
        timescale: runner.timescale,
        ...(nextLocation !== undefined ? { lastLocation: nextLocation } : {}),
      };
      this.runners.set(guid, next);

      const reenterMutateIntent: MutateIntentFn = (intentGuid, patch) => {
        if (Object.keys(patch).length === 0) return;
        const update: RuntimeUpdate = { entityType: 'intent', guid: intentGuid, patch, source: 'hub:animation' };
        this.runtimeUpdateDispatcher.dispatch([update], next.lastLocation ?? location, Date.now());
      };

      fresh.start(g => this.intentAccessFn(g), reenterMutateIntent);
    }
  }

  /** When an intent row is removed from the project, stop animations targeting it. */
  onIntentRemovedFromProject(intentGuid: string): void {
    for (const [guid, runner] of [...this.runners]) {
      if (runner.targetIntentGuid === intentGuid) {
        this.stopRunner(guid, 'target intent removed');
      }
    }
    for (const guid of [...this.edits.keys()]) {
      const def = this.projectManager.getAnimationByGuid(guid) as Record<string, unknown> | undefined;
      const target = typeof def?.['targetIntent'] === 'string' ? def['targetIntent']
        : typeof def?.['intent'] === 'string' ? def['intent']
        : undefined;
      if (target === intentGuid) {
        this.exitEditMode(guid);
      }
    }
  }

  /** Stop runner when animation definition is removed from the project graph. */
  onAnimationRemoved(animationGuid: string, _location?: [number, number]): void {
    this.stopRunner(animationGuid, 'animation removed');
    this.exitEditMode(animationGuid);
  }
}
