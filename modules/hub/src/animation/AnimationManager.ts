import type { ProjectManager, ControllerIntent, SnapshotAnimationState } from '../ProjectManager';
import type { RuntimeIntentStore } from '../RuntimeIntentStore';
import type { RuntimeUpdateDispatcher } from '../RuntimeUpdateDispatcher';
import { HubStatusDispatcher, type HubStatusAnimationPayload } from '../hubStatusTypes';
import type { MutateIntentFn } from './keyframeAnimator';
import { getAnimatorClass, type AnimatorPlugin } from './animatorRegistry';
import { Logger } from '../Logger';
import type { RuntimeUpdate } from '../RuntimeProtocol';
import type { BindingManager } from '../BindingManager';
import { globalState } from '../GlobalState';
import { cloneRecord, diffRecordsToPatch } from '../dotPath';
import { resolveAnimationTargetIntents } from './resolveAnimationTargetIntents';
/**
 * Companion runner actions share the animation row's guid (`action:trigger` passes that guid).
 */
export function companionActionGuid(animationGuid: string): string {
  return animationGuid;
}

type ActiveRunner = {
  plugin: AnimatorPlugin;
  targetIntentGuids: string[];
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
   * Animations currently in edit mode. Disjoint from {@link runners} —
   * `enterEditMode` always stops the runner first; `trigger` always exits edit first.
   */
  private edits = new Map<string, AnimatorPlugin>();
  /**
   * Baseline intent snapshot per animation in keyframe edit mode (authoritative stepped state).
   * Manual runtime edits do not update this; {@link diffRecordsToPatch} vs effective intent builds new keyframe args on Add.
   */
  private editIntentBaselines = new Map<
    string,
    { targetGuid: string; baseline: Record<string, unknown> }
  >();
  private onInternalStatus?: (guid: string, payload: AnimationStatusPayload) => void;

  constructor(
    private projectManager: ProjectManager,
    private runtimeIntentStore: RuntimeIntentStore,
    private hubStatus: HubStatusDispatcher,
    private runtimeUpdateDispatcher: RuntimeUpdateDispatcher,
    private bindingManager?: BindingManager,
  ) {
    globalState.subscribe(key => {
      if (key === 'editmode') {
        this.setEditPaused(globalState.getItem('editmode') === true);
      }
    });
  }

  setInternalStatusListener(cb: (guid: string, payload: AnimationStatusPayload) => void): void {
    this.onInternalStatus = cb;
  }

  /**
   * Freeze/resume every active runner on edit-mode change. Runners keep their position and continue
   * from where they froze (no restart, no status broadcast) — the surface edits against a still look.
   */
  setEditPaused(paused: boolean): void {
    for (const runner of this.runners.values()) {
      if (paused) {
        runner.plugin.pause();
      } else {
        runner.plugin.resume();
      }
    }
  }

  private timescaleBindingKey(animationGuid: string): string {
    return `${animationGuid}-timescale`;
  }

  /** Effective timescale for hub binding: active runner, else persisted animation row, else 1. */
  private getTimescaleForBinding(animationGuid: string): number {
    const runner = this.runners.get(animationGuid);
    if (
      runner &&
      typeof runner.timescale === 'number' &&
      Number.isFinite(runner.timescale) &&
      runner.timescale > 0
    ) {
      return runner.timescale;
    }
    const def = this.projectManager.getAnimationByGuid(animationGuid) as unknown as
      | Record<string, unknown>
      | undefined;
    const ts = def?.['timescale'];
    if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) {
      return ts;
    }
    return 1;
  }

  /** Idempotent: replaces master so get/set always resolve through {@link getTimescaleForBinding} / {@link setTimescale}. */
  private ensureTimescaleMaster(animationGuid: string): void {
    if (!this.bindingManager) {
      return;
    }
    const key = this.timescaleBindingKey(animationGuid);
    this.bindingManager.registerMaster(
      key,
      () => this.getTimescaleForBinding(animationGuid),
      value => {
        const n = Number(value);
        this.setTimescale(animationGuid, n);
      },
    );
  }

  private unregisterTimescaleMaster(animationGuid: string): void {
    this.bindingManager?.unregisterMaster(this.timescaleBindingKey(animationGuid));
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
   * Finite run completed all cycles; plugin is idle — remove runner without tearing down timescale binding.
   */
  private unregisterNaturallyFinishedRunner(animationGuid: string): void {
    const existing = this.runners.get(animationGuid);
    if (!existing) return;
    for (const guid of existing.targetIntentGuids) {
      this.runtimeUpdateDispatcher.dispatch(
        [{ entityType: 'intent', guid, drag: 'end', source: 'hub:animation' }],
        undefined,
        Date.now(),
      );
    }
    existing.plugin.stripTimers();
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
   * {@link commandArgs} (from action trigger merged params) are forwarded to the animator's
   * {@code executeCommand} when the runner exists and is in manual mode.
   */
  trigger(animationGuid: string, opts: { location?: [number, number]; timescale?: number; commandArgs?: Record<string, unknown> } = {}): void {
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
    const AnimatorCtor = getAnimatorClass(animClass);
    if (!AnimatorCtor) {
      Logger.warn(`[animation] unknown class "${animClass}" for ${animationGuid}`);
      return;
    }

    const targets = resolveAnimationTargetIntents(record);
    if (targets.length === 0) {
      Logger.warn(`[animation] missing targetIntents for ${animationGuid}`);
      return;
    }

    let runmode: string = typeof record['runmode'] === 'string' ? record['runmode'] : 'auto';

    const hasCommand = opts.commandArgs !== undefined && typeof opts.commandArgs['command'] === 'string';

    switch (runmode) {
      case 'manual': {
        const existingRunner = this.runners.get(animationGuid);
        if (existingRunner) {
          if (hasCommand) {
            existingRunner.plugin.executeCommand(opts.commandArgs!);
          }
          return;
        }
        break;
      }
      default:
        this.stopRunner(animationGuid, 'replaced');
        break;
    }

    const inScene = targets.some(t => this.projectManager.isIntentInActiveScene(t));
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

    const plugin = new AnimatorCtor(animationGuid, {
      onStatus: p => {
        this.emitAnimatorStatus(animationGuid, p, opts.location ?? this.runners.get(animationGuid)?.lastLocation);
      },
      onDefinitionChanged: () => this.projectManager.touchAnimations(),
      getDefinitionRecord: () =>
        this.projectManager.getAnimationByGuid(animationGuid) as unknown as Record<string, unknown> | undefined,
    });
    plugin.setTimescale(effectiveTimescale);

    const runnerBase: ActiveRunner = {
      plugin,
      targetIntentGuids: targets,
      lastInScene: inScene,
      timescale: effectiveTimescale,
      ...(opts.location !== undefined ? { lastLocation: opts.location } : {}),
    };

    if (!inScene) {
      plugin.onSceneMembershipChanged(false);
      this.runners.set(animationGuid, runnerBase);
      this.ensureTimescaleMaster(animationGuid);
      return;
    }

    this.runners.set(animationGuid, runnerBase);
    this.ensureTimescaleMaster(animationGuid);

    const mutateIntent: MutateIntentFn = (guid, patch) => {
      if (Object.keys(patch).length === 0) return;
      const update: RuntimeUpdate = { entityType: 'intent', guid, patch, source: 'hub:animation', drag: 'move' };
      this.runtimeUpdateDispatcher.dispatch([update], opts.location, Date.now());
    };

    plugin.start(g => this.intentAccessFn(g), mutateIntent);
    plugin.setRunMode(runmode);

    if (hasCommand) {
      plugin.executeCommand(opts.commandArgs!);
    }
  }

  /** Mid-run playback factor; timeouts already queued keep old delays until they fire (V1). */
  setTimescale(animationGuid: string, factor: number): void {
    if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) {
      Logger.warn('[animation] setTimescale ignored — need finite factor > 0:', factor);
      return;
    }
    const runner = this.runners.get(animationGuid);
    if (!runner) {
      this.projectManager.patchAnimationFields(animationGuid, { timescale: factor });
      this.bindingManager?.receiveFromMaster(this.timescaleBindingKey(animationGuid), factor);
      return;
    }
    runner.timescale = factor;
    runner.plugin.setTimescale(factor);
    this.bindingManager?.receiveFromMaster(this.timescaleBindingKey(animationGuid), runner.timescale);
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
    for (const guid of existing.targetIntentGuids) {
      this.runtimeUpdateDispatcher.dispatch(
        [{ entityType: 'intent', guid, drag: 'end', source: 'hub:animation' }],
        undefined,
        Date.now(),
      );
    }
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
    for (const anim of this.projectManager.getAnimationsWirePayload()) {
      const guid = anim.guid;
      if (typeof guid === 'string' && guid.length > 0) {
        this.unregisterTimescaleMaster(guid);
      }
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
    const AnimatorCtor = getAnimatorClass(animClass);
    if (!AnimatorCtor) {
      Logger.warn(`[animation] enterEditMode unknown class "${animClass}" for ${animationGuid}`);
      return;
    }

    if (this.runners.has(animationGuid)) {
      this.stopRunner(animationGuid, 'replaced by edit');
    }

    const plugin = new AnimatorCtor(animationGuid, {
      onStatus: p => {
        this.emitAnimatorStatus(animationGuid, p, opts.location);
      },
      onDefinitionChanged: () => this.projectManager.touchAnimations(),
      getDefinitionRecord: () =>
        this.projectManager.getAnimationByGuid(animationGuid) as unknown as Record<string, unknown> | undefined,
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
      commitEditIntentBaseline: (targetGuid: string) => {
        this.commitEditIntentBaseline(animationGuid, targetGuid);
      },
      getEditIntentDeltaPatch: (targetGuid: string) =>
        this.getEditIntentDeltaPatch(animationGuid, targetGuid),
    });

    this.edits.set(animationGuid, plugin);
  }

  private commitEditIntentBaseline(animationGuid: string, targetGuid: string): void {
    const eff = this.intentAccessFn(targetGuid);
    if (!eff) {
      Logger.warn(`[animation] commitEditIntentBaseline skipped — no intent for ${targetGuid}`);
      return;
    }
    this.editIntentBaselines.set(animationGuid, {
      targetGuid,
      baseline: cloneRecord(eff as unknown as Record<string, unknown>),
    });
  }

  private getEditIntentDeltaPatch(animationGuid: string, targetGuid: string): Record<string, unknown> {
    const entry = this.editIntentBaselines.get(animationGuid);
    if (!entry || entry.targetGuid !== targetGuid) {
      return {};
    }
    const current = this.intentAccessFn(targetGuid);
    if (!current) {
      return {};
    }
    return diffRecordsToPatch(
      entry.baseline,
      current as unknown as Record<string, unknown>,
    );
  }

  /** Exit edit mode for `animationGuid`. The animator unregisters its own bindings. */
  exitEditMode(animationGuid: string): void {
    const plugin = this.edits.get(animationGuid);
    if (!plugin) return;
    plugin.exitEditMode();
    this.edits.delete(animationGuid);
    this.editIntentBaselines.delete(animationGuid);
  }

  /**
   * After graph commands / scene changes: update membership for running animations.
   */
  notifyActiveSceneIntentMembershipChanged(location?: [number, number]): void {
    for (const [guid, runner] of [...this.runners]) {
      const now = runner.targetIntentGuids.some(t =>
        this.projectManager.isIntentInActiveScene(t),
      );
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

      runner.plugin.onSceneMembershipChanged(true);
    }
  }

  /** When an intent row is removed from the project, stop animations targeting it. */
  onIntentRemovedFromProject(intentGuid: string): void {
    for (const [guid, runner] of [...this.runners]) {
      if (runner.targetIntentGuids.includes(intentGuid)) {
        this.stopRunner(guid, 'target intent removed');
      }
    }
    for (const guid of [...this.edits.keys()]) {
      const def = this.projectManager.getAnimationByGuid(guid) as Record<string, unknown> | undefined;
      const editTargets = resolveAnimationTargetIntents(def);
      if (editTargets.includes(intentGuid)) {
        this.exitEditMode(guid);
      }
    }
  }

  /** Stop runner when animation definition is removed from the project graph. */
  onAnimationRemoved(animationGuid: string, _location?: [number, number]): void {
    this.stopRunner(animationGuid, 'animation removed');
    this.exitEditMode(animationGuid);
    this.unregisterTimescaleMaster(animationGuid);
  }

  /**
   * Apply class-specific defaults and normalize shape on an incoming animation record before
   * it is persisted. Delegates to the animator class's static {@code normalizeRecord} if one
   * exists; otherwise returns a shallow clone with {@code guid} set.
   */
  normalizeAnimationRecord(value: Record<string, unknown>, guid: string): Record<string, unknown> {
    const cls = typeof value['class'] === 'string' ? value['class'] : '';
    const Ctor = cls ? getAnimatorClass(cls) : undefined;
    const staticNormalize = (Ctor as unknown as { normalizeRecord?: (v: Record<string, unknown>, g: string) => Record<string, unknown> } | undefined)?.normalizeRecord;
    if (staticNormalize) {
      return staticNormalize(value, guid);
    }
    const out = cloneRecord(value);
    out['guid'] = guid;
    return out;
  }

  /**
   * After `graph:command` updates an animation while keyframe edit is open: re-pin steps to
   * `content.length` and refresh the edit binding. Returns whether `content.steps` changed on disk.
   */
  reconcileKeyframeEditAfterAnimationGraphMutation(animationGuid: string): boolean {
    const plugin = this.edits.get(animationGuid);
    if (!plugin) return false;
    return plugin.reconcileStoredStepsAfterGraphMutation();
  }

  hasOpenEditMode(): boolean {
    return this.edits.size > 0;
  }

  captureRunnerStates(): SnapshotAnimationState[] {
    const states: SnapshotAnimationState[] = [];
    for (const [guid, runner] of this.runners) {
      if (!runner.plugin.isCapturableForSnapshot()) continue;
      states.push({
        guid,
        timescale: runner.timescale,
      });
    }
    return states;
  }

  /**
   * Snapshot recall: stop runners not in `states`, then apply each stored row without
   * re-instantiating animations that are already playing.
   */
  recallSnapshotAnimations(states: SnapshotAnimationState[], location?: [number, number]): void {
    const storedGuids = new Set(states.map(s => s.guid));
    const stopOpts = location !== undefined ? { location } : undefined;
    for (const guid of [...this.runners.keys()]) {
      if (!storedGuids.has(guid)) {
        this.stop(guid, stopOpts);
      }
    }
    for (const state of states) {
      const existing = this.runners.get(state.guid);
      if (existing?.plugin.isCapturableForSnapshot()) {
        this.setTimescale(state.guid, state.timescale);
      } else {
        const opts: { location?: [number, number]; timescale?: number } = {
          timescale: state.timescale,
        };
        if (location !== undefined) {
          opts.location = location;
        }
        this.trigger(state.guid, opts);
      }
    }
  }
}
