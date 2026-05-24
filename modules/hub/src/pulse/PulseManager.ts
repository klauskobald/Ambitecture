import { randomInt } from 'crypto';
import type { ProjectManager, PulseSetup, PulseSlotMode, SnapshotPulseState } from '../ProjectManager';
import type { PulseSetupManager } from './PulseSetupManager';
import { Logger } from '../Logger';
import type { HubStatusDispatcher, HubStatusPulsePayload } from '../hubStatusTypes';
import { parsePulseSyncProjectConfig } from './PulseSyncConfig';
import { resolvePulseSetupSpeed } from './pulseSetupSpeed';

type ActivePulseRunner = {
  setup: PulseSetup;
  isRunning: boolean;
  currentSlotIdx: number;
  /** Wall-clock ms when the pending tick should fire. */
  nextTickAtMs: number;
  tickTimer: ReturnType<typeof setTimeout> | undefined;
  msIntoCurrentTick: number;
  /** Live tempo from analyser sync; not written to project YAML until explicit edit. */
  liveBpm?: number;
};

/**
 * Hub-side pulse orchestration. Each setup may run its own tick loop independently.
 * Slots reference buckets in `pulses.buckets`; tick interval uses `bpm * speed`.
 */
/** Incoming `pulse:sync` BPM at or below this pauses ticking without stopping runners. */
export const PULSE_SYNC_PAUSE_BPM_THRESHOLD = 10;

export class PulseManager {
  private readonly runners = new Map<string, ActivePulseRunner>();
  /** Single lerped musical BPM from `pulse:sync` when project sync is enabled. */
  private syncSharedLiveBpm: number | undefined;
  /** Timers cleared while sync BPM is at or below {@link PULSE_SYNC_PAUSE_BPM_THRESHOLD}. */
  private syncPausedForLowBpm = false;
  private onTriggerAction?: (actionGuid: string) => void;
  private hubStatus?: HubStatusDispatcher;

  constructor(private projectManager: ProjectManager) { }

  setHubStatusDispatcher(dispatcher: HubStatusDispatcher): void {
    this.hubStatus = dispatcher;
  }

  /**
   * Register callback for action triggering. Called when a pulse slot's action fires.
   */
  setActionTriggerCallback(cb: (actionGuid: string) => void): void {
    this.onTriggerAction = cb;
  }

  /**
   * Call after project is loaded to initialize the active pulse from persistent state.
   */
  initializeFromProject(): void {
    const activePulseGuid = this.projectManager.getActivePulseGuid();
    if (activePulseGuid) {
      this.startSetup(activePulseGuid);
    }
  }

  /**
   * Re-read one setup from project YAML after `pulse:assign` / `pulse:control`.
   */
  syncSetupFromProject(setupGuid: string): void {
    const runner = this.runners.get(setupGuid);
    if (!runner) return;
    const setup = this.projectManager.getPulseSetup(setupGuid);
    if (!setup) {
      Logger.warn(`[pulse] syncSetupFromProject: setup ${setupGuid} no longer exists`);
      return;
    }
    runner.setup = setup;
    if (runner.currentSlotIdx >= setup.slots.length) {
      runner.currentSlotIdx = 0;
    }
  }

  /** Re-sync every runner that is loaded (running or idle). */
  syncActiveSetupFromProject(): void {
    for (const guid of this.runners.keys()) {
      this.syncSetupFromProject(guid);
    }
  }

  private getRunnerBpm(runner: ActivePulseRunner): number {
    if (this.syncSharedLiveBpm !== undefined) {
      return this.syncSharedLiveBpm;
    }
    const live = runner.liveBpm;
    if (typeof live === 'number' && Number.isFinite(live)) {
      return live;
    }
    return runner.setup.bpm;
  }

  /** BPM used as the “current” side of sync lerp (shared live tempo when set). */
  getReferenceBpmForSyncLerp(): number | undefined {
    if (this.syncSharedLiveBpm !== undefined) {
      return this.syncSharedLiveBpm;
    }
    for (const [, runner] of this.runners) {
      if (runner.isRunning) {
        return this.getRunnerBpm(runner);
      }
    }
    const focus = this.projectManager.getActivePulseGuid();
    if (focus) {
      const setup = this.projectManager.getPulseSetup(focus);
      if (setup) return setup.bpm;
    }
    const first = this.projectManager.getPulsesWirePayload().setups[0];
    return first?.bpm;
  }

  setSyncSharedLiveBpm(bpm: number): void {
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    this.syncSharedLiveBpm = bpm;
  }

  clearSyncSharedLiveBpm(): void {
    this.syncSharedLiveBpm = undefined;
    for (const runner of this.runners.values()) {
      delete runner.liveBpm;
    }
  }

  getSyncSharedLiveBpm(): number | undefined {
    return this.syncSharedLiveBpm;
  }

  isSyncPausedForLowBpm(): boolean {
    return this.syncPausedForLowBpm;
  }

  /**
   * Pause ticking for all running setups (e.g. analyser silent BPM). Runners stay
   * `isRunning`; no `hub:status` stopped broadcast.
   */
  pauseRunningForSyncLowBpm(): void {
    if (this.syncPausedForLowBpm) {
      return;
    }
    this.syncPausedForLowBpm = true;
    for (const guid of this.getRunningSetupGuids()) {
      this.stopTimerFor(guid);
    }
    Logger.info(
      `[pulse] paused (sync BPM ≤ ${PULSE_SYNC_PAUSE_BPM_THRESHOLD}); runners kept active`,
    );
  }

  /** @returns whether pause was active before clear. */
  clearSyncPausedForLowBpm(): boolean {
    const was = this.syncPausedForLowBpm;
    this.syncPausedForLowBpm = false;
    return was;
  }

  /** @returns {string[]} guids of setups currently ticking. */
  getRunningSetupGuids(): string[] {
    const guids: string[] = [];
    for (const [guid, runner] of this.runners) {
      if (runner.isRunning) guids.push(guid);
    }
    return guids;
  }

  private resolveActiveSetup(setupGuid: string): PulseSetup | undefined {
    const runner = this.runners.get(setupGuid);
    if (!runner) return undefined;
    const guid = runner.setup.guid;
    if (!guid) return undefined;
    return this.projectManager.getPulseSetup(guid);
  }

  getStatusSnapshots(): HubStatusPulsePayload[] {
    const snapshots: HubStatusPulsePayload[] = [];
    for (const [setupGuid, runner] of this.runners) {
      if (!runner.isRunning) continue;
      const payload = this.buildPulseStatusPayload(setupGuid, 'started', runner.currentSlotIdx, runner);
      snapshots.push(payload);
    }
    return snapshots;
  }

  /** @deprecated Prefer {@link getStatusSnapshots}. */
  getStatusSnapshot(): HubStatusPulsePayload | undefined {
    return this.getStatusSnapshots()[0];
  }

  /**
   * Compute milliseconds per tick from musical BPM and setup speed.
   * Tick = one slot = one quarter note at effective rate `bpm * speed`.
   */
  private computeTickIntervalMs(bpm: number, setup: PulseSetup): number {
    const speed = resolvePulseSetupSpeed(setup);
    const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
    const eff = safeBpm * speed;
    if (!Number.isFinite(eff) || eff <= 0) {
      return Math.round(60000 / 120);
    }
    return Math.round(60000 / eff);
  }

  /**
   * Start (or restart) a pulse setup without stopping other running setups.
   */
  startSetup(guid: string): void {
    const setup = this.projectManager.getPulseSetup(guid);
    if (!setup) {
      Logger.warn(`[pulse] unknown pulse setup ${guid}`);
      return;
    }

    const existing = this.runners.get(guid);
    if (existing?.isRunning) {
      this.restartSetup(guid);
      return;
    }

    if (existing) {
      existing.setup = setup;
      this.projectManager.setActivePulseGuid(guid);
      this.startRunner(guid);
      return;
    }

    this.runners.set(guid, {
      setup,
      isRunning: false,
      currentSlotIdx: 0,
      nextTickAtMs: 0,
      tickTimer: undefined,
      msIntoCurrentTick: 0,
    });
    this.projectManager.setActivePulseGuid(guid);
    Logger.info(`[pulse] selected setup ${guid} (${setup.name}, ${setup.bpm} BPM, ${setup.meter} meter)`);
    this.startRunner(guid);
  }

  /**
   * Legacy alias: starts the setup without stopping others (same as {@link startSetup}).
   */
  selectSetup(guid: string): void {
    this.startSetup(guid);
  }

  /**
   * Stop one pulse setup; other setups keep running.
   */
  stopSetup(guid: string): void {
    const runner = this.runners.get(guid);
    if (!runner) {
      Logger.warn(`[pulse] stopSetup called but setup ${guid} is not loaded`);
      return;
    }
    this.stopRunner(guid);
  }

  /**
   * Activate a setup for external sync without firing an immediate tick.
   * Caller should follow with {@link applyAlignedSync}.
   */
  selectSetupForSync(guid: string): void {
    const setup = this.projectManager.getPulseSetup(guid);
    if (!setup) {
      Logger.warn(`[pulse] unknown pulse setup ${guid}`);
      return;
    }

    const existing = this.runners.get(guid);
    if (existing) {
      this.stopTimerFor(guid);
      existing.setup = setup;
      existing.isRunning = false;
      existing.currentSlotIdx = 0;
      existing.nextTickAtMs = 0;
      existing.msIntoCurrentTick = 0;
    } else {
      this.runners.set(guid, {
        setup,
        isRunning: false,
        currentSlotIdx: 0,
        nextTickAtMs: 0,
        tickTimer: undefined,
        msIntoCurrentTick: 0,
      });
    }
    this.projectManager.setActivePulseGuid(guid);
    Logger.info(`[pulse] selected setup for sync ${guid} (${setup.name})`);
  }

  /**
   * Phase-align every running setup to the shared sync BPM (per-setup speed for tick period).
   */
  applyAlignedSyncToAllRunning(
    bpm: number,
    beatAtHubMs: number,
    scheduleLeadMs: number,
    restartFromSlotZero = false,
  ): void {
    this.setSyncSharedLiveBpm(bpm);
    const running = this.getRunningSetupGuids();
    if (running.length === 0) {
      return;
    }
    const receivedAtMs = Date.now();
    for (const setupGuid of running) {
      const nextTickAtMs = this.computeAlignedNextTickAtMs(
        bpm,
        setupGuid,
        beatAtHubMs,
        receivedAtMs,
        scheduleLeadMs,
      );
      this.applyAlignedSyncOne(
        setupGuid,
        bpm,
        beatAtHubMs,
        scheduleLeadMs,
        restartFromSlotZero,
        false,
        nextTickAtMs,
      );
    }
    Logger.info(
      `[pulse] aligned sync BPM=${bpm} to ${running.length} running setup(s)`
        + (restartFromSlotZero ? ' (slot 0)' : ''),
    );
  }

  private computeAlignedNextTickAtMs(
    bpm: number,
    setupGuid: string,
    beatAtHubMs: number,
    receivedAtMs: number,
    scheduleLeadMs: number,
  ): number {
    const setup = this.projectManager.getPulseSetup(setupGuid);
    const speed = resolvePulseSetupSpeed(setup);
    const periodMs = 60000 / (bpm * speed);
    let beatIndex = Math.ceil(
      (receivedAtMs + scheduleLeadMs - beatAtHubMs) / periodMs,
    );
    if (!Number.isFinite(beatIndex) || beatIndex < 0) {
      beatIndex = 0;
    }
    return beatAtHubMs + beatIndex * periodMs;
  }

  private applyAlignedSyncOne(
    setupGuid: string,
    bpm: number,
    beatAtHubMs: number,
    scheduleLeadMs: number,
    restartFromSlotZero: boolean,
    logTiming: boolean,
    nextTickAtMsOverride?: number,
  ): void {
    const runner = this.runners.get(setupGuid);
    if (!runner) {
      Logger.warn(`[pulse] applyAlignedSyncOne: no runner for ${setupGuid}`);
      return;
    }
    const setup = this.projectManager.getPulseSetup(setupGuid);
    if (setup) {
      runner.setup = setup;
    }
    delete runner.liveBpm;
    runner.isRunning = true;
    if (restartFromSlotZero) {
      runner.currentSlotIdx = 0;
      runner.msIntoCurrentTick = 0;
    }
    const nextTickAtMs = nextTickAtMsOverride ?? this.computeAlignedNextTickAtMs(
      bpm,
      setupGuid,
      beatAtHubMs,
      Date.now(),
      scheduleLeadMs,
    );
    if (logTiming) {
      Logger.info(
        `[pulse] aligned sync BPM=${bpm} nextTick in ${Math.max(0, nextTickAtMs - Date.now())}ms`
          + (restartFromSlotZero ? ' (slot 0)' : ''),
      );
    }
    this.scheduleTickAt(setupGuid, nextTickAtMs);
  }

  /**
   * Apply shared sync BPM to all running setups without rescheduling ticks.
   */
  updateSyncLiveTempoOnAllRunning(bpm: number): void {
    this.setSyncSharedLiveBpm(bpm);
    const running = this.getRunningSetupGuids();
    for (const setupGuid of running) {
      const runner = this.runners.get(setupGuid);
      if (!runner) continue;
      delete runner.liveBpm;
      const setup = this.projectManager.getPulseSetup(setupGuid);
      if (setup) {
        runner.setup = setup;
      }
      const periodMs = this.computeTickIntervalMs(bpm, runner.setup);
      Logger.info(
        `[pulse] live sync tempo ${bpm} BPM for ${setupGuid} (${periodMs}ms/tick, timer unchanged)`,
      );
    }
    if (running.length === 0) {
      Logger.info(`[pulse] live sync tempo ${bpm} BPM (no running setups)`);
    }
  }

  /**
   * Reset slot cursor on every running setup (onset/bar restart policy).
   */
  resetSlotIndexToZeroOnAllRunning(): void {
    for (const [, runner] of this.runners) {
      if (!runner.isRunning) continue;
      runner.currentSlotIdx = 0;
      runner.msIntoCurrentTick = 0;
    }
  }

  private restartSetup(setupGuid: string): void {
    const runner = this.runners.get(setupGuid);
    if (!runner) return;
    this.stopTimerFor(setupGuid);
    runner.currentSlotIdx = 0;
    runner.msIntoCurrentTick = 0;
    runner.isRunning = true;
    this.scheduleNextTick(setupGuid);
    Logger.info(`[pulse] restarted setup ${setupGuid}`);
  }

  /**
   * Set BPM on a setup. Does not reschedule the pending tick.
   */
  setBPM(bpm: number, setupGuid?: string): void {
    const guid = setupGuid ?? this.projectManager.getActivePulseGuid() ?? this.getActiveSetupGuid();
    if (!guid) {
      Logger.warn('[pulse] setBPM called but no pulse is active');
      return;
    }
    const runner = this.runners.get(guid);
    if (!runner) {
      Logger.warn('[pulse] setBPM called but no pulse runner exists');
      return;
    }
    const setup = this.projectManager.getPulseSetup(guid);
    if (setup) {
      runner.setup = setup;
    }
    runner.setup.bpm = bpm;
    delete runner.liveBpm;
    this.clearSyncSharedLiveBpm();
    Logger.info(`[pulse] BPM set to ${bpm} (setup ${guid})`);
  }

  /**
   * Set meter (beats per measure) on a setup.
   */
  setMeter(meter: number, setupGuid?: string): void {
    const guid = setupGuid ?? this.projectManager.getActivePulseGuid() ?? this.getActiveSetupGuid();
    if (!guid) return;
    const runner = this.runners.get(guid);
    if (!runner) {
      Logger.warn('[pulse] setMeter called but no pulse runner exists');
      return;
    }
    runner.setup.meter = meter;
    Logger.info(`[pulse] meter set to ${meter}`);
  }

  private startRunner(setupGuid: string): void {
    const runner = this.runners.get(setupGuid);
    if (!runner) {
      Logger.warn('[pulse] start called but setup is not loaded');
      return;
    }
    if (runner.isRunning) {
      Logger.info('[pulse] already running');
      return;
    }

    const setup = this.projectManager.getPulseSetup(setupGuid);
    if (setup) {
      runner.setup = setup;
    }

    runner.isRunning = true;
    runner.currentSlotIdx = 0;
    runner.msIntoCurrentTick = 0;

    const periodMs = this.computeTickIntervalMs(this.getRunnerBpm(runner), runner.setup);
    Logger.info(`[pulse] started (${runner.setup.name}, ${periodMs}ms/tick)`);
    this.scheduleNextTick(setupGuid);
  }

  /**
   * Stop pulse ticking for one setup.
   */
  stop(): void {
    const guid = this.getActiveSetupGuid();
    if (!guid) {
      Logger.warn('[pulse] stop called but no pulse is active');
      return;
    }
    this.stopSetup(guid);
  }

  private stopRunner(setupGuid: string): void {
    const runner = this.runners.get(setupGuid);
    if (!runner) return;
    this.stopTimerFor(setupGuid);
    runner.isRunning = false;
    this.broadcastPulseStatus(setupGuid, 'stopped', runner.currentSlotIdx);
    Logger.info(`[pulse] stopped setup ${setupGuid}`);
  }

  private stopTimerFor(setupGuid: string): void {
    const runner = this.runners.get(setupGuid);
    if (!runner) return;
    if (runner.tickTimer !== undefined) {
      clearTimeout(runner.tickTimer);
      runner.tickTimer = undefined;
    }
  }

  /**
   * Wait until {@link nextTickAtMs}, then fire one tick and schedule the next from current BPM.
   */
  private scheduleTickAt(setupGuid: string, nextTickAtMs: number): void {
    const runner = this.runners.get(setupGuid);
    if (!runner || !runner.isRunning || this.syncPausedForLowBpm) {
      return;
    }

    this.stopTimerFor(setupGuid);
    runner.nextTickAtMs = nextTickAtMs;
    const delayMs = Math.max(0, nextTickAtMs - Date.now());
    runner.tickTimer = setTimeout(() => {
      this.onTickTimerFired(setupGuid);
    }, delayMs);
  }

  private onTickTimerFired(setupGuid: string): void {
    const runner = this.runners.get(setupGuid);
    if (!runner || !runner.isRunning) {
      return;
    }
    runner.tickTimer = undefined;
    this.tickRound(setupGuid);
    const periodMs = this.computeTickIntervalMs(
      this.getRunnerBpm(runner),
      runner.setup,
    );
    this.scheduleTickAt(setupGuid, Date.now() + periodMs);
  }

  private computeNextTickAtMsFromNow(setupGuid: string): number {
    const runner = this.runners.get(setupGuid);
    if (!runner) {
      return Date.now();
    }
    const periodMs = this.computeTickIntervalMs(
      this.getRunnerBpm(runner),
      runner.setup,
    );
    return Date.now() + periodMs;
  }

  /**
   * Add an action GUID to the bucket assigned to a slot.
   */
  addSlotAction(slotIdx: number, actionGuid: string, setupGuid?: string): void {
    const guid = setupGuid ?? this.getActiveSetupGuid();
    if (!guid) {
      Logger.warn('[pulse] addSlotAction called but no pulse is active');
      return;
    }
    const runner = this.runners.get(guid);
    if (!runner) {
      Logger.warn('[pulse] addSlotAction called but no pulse runner exists');
      return;
    }
    const bucket = this.bucketForSlot(runner.setup, slotIdx);
    if (!bucket) {
      return;
    }
    if (bucket.actions.includes(actionGuid)) {
      Logger.info(`[pulse] action ${actionGuid} already in bucket ${bucket.guid} (slot ${slotIdx})`);
      return;
    }

    bucket.actions.push(actionGuid);
    this.projectManager.touchPulses();
    Logger.info(`[pulse] added action ${actionGuid} to bucket ${bucket.guid} (slot ${slotIdx})`);
  }

  /**
   * Remove an action GUID from the bucket assigned to a slot.
   */
  removeSlotAction(slotIdx: number, actionGuid: string, setupGuid?: string): void {
    const guid = setupGuid ?? this.getActiveSetupGuid();
    if (!guid) {
      Logger.warn('[pulse] removeSlotAction called but no pulse is active');
      return;
    }
    const runner = this.runners.get(guid);
    if (!runner) {
      Logger.warn('[pulse] removeSlotAction called but no pulse runner exists');
      return;
    }
    const bucket = this.bucketForSlot(runner.setup, slotIdx);
    if (!bucket) {
      return;
    }
    const idx = bucket.actions.indexOf(actionGuid);
    if (idx === -1) {
      Logger.warn(`[pulse] action ${actionGuid} not in bucket ${bucket.guid} (slot ${slotIdx})`);
      return;
    }

    bucket.actions.splice(idx, 1);
    this.projectManager.touchPulses();
    Logger.info(`[pulse] removed action ${actionGuid} from bucket ${bucket.guid} (slot ${slotIdx})`);
  }

  /** Play / restart: fire current slot once, then schedule next tick from current BPM. */
  private scheduleNextTick(setupGuid: string): void {
    const runner = this.runners.get(setupGuid);
    if (!runner || !runner.isRunning) {
      return;
    }

    this.stopTimerFor(setupGuid);
    this.tickRound(setupGuid);
    this.scheduleTickAt(setupGuid, this.computeNextTickAtMsFromNow(setupGuid));
  }

  /**
   * Execute one tick: dispatch all actions in the current slot's bucket, advance slot index.
   */
  private tickRound(setupGuid: string): void {
    const runner = this.runners.get(setupGuid);
    if (!runner || !runner.isRunning) {
      return;
    }

    const setup = this.resolveActiveSetup(setupGuid);
    if (!setup) {
      return;
    }
    runner.setup = setup;

    const slotIdx = runner.currentSlotIdx;
    const slot = setup.slots[slotIdx];
    if (slot?.active === true) {
      const actionGuids = this.projectManager.getPulseSlotActionGuids(setup, slotIdx);
      for (const actionGuid of actionGuids) {
        this.dispatchActionItem(actionGuid, setupGuid);
      }
    }

    this.broadcastPulseStatus(setupGuid, 'started', slotIdx);

    runner.currentSlotIdx = this.advanceSlotIdx(setup, slotIdx);
    runner.msIntoCurrentTick = 0;
  }

  private resolveSlotAdvanceMode(setup: PulseSetup): PulseSlotMode {
    const mode = setup.mode === 'backward' || setup.mode === 'random'
      ? setup.mode
      : 'forward';
    if (setup.meter <= 2 && mode === 'random') {
      return 'forward';
    }
    return mode;
  }

  /**
   * Next slot after {@link slotIdx} fired. `random` never returns the same index twice in a row.
   */
  private advanceSlotIdx(setup: PulseSetup, slotIdx: number): number {
    const slotsTotal = setup.slots.length;
    if (slotsTotal === 0) {
      return 0;
    }
    const mode = this.resolveSlotAdvanceMode(setup);
    switch (mode) {
      case 'backward':
        return (slotIdx - 1 + slotsTotal) % slotsTotal;
      case 'random':
        return this.pickRandomSlotIndexOtherThan(slotIdx, slotsTotal);
      default:
        return (slotIdx + 1) % slotsTotal;
    }
  }

  /** Uniform pick in `[0, slotsTotal)` excluding `excludeIdx` (requires `slotsTotal` ≥ 2). */
  private pickRandomSlotIndexOtherThan(excludeIdx: number, slotsTotal: number): number {
    if (slotsTotal <= 1) {
      return 0;
    }
    const next = randomInt(0, slotsTotal - 1);
    return next >= excludeIdx ? next + 1 : next;
  }

  /**
   * Dispatch a single action by GUID via the registered callback.
   */
  private dispatchActionItem(actionGuid: string, setupGuid: string): void {
    if (!this.onTriggerAction) {
      Logger.warn(`[pulse] action trigger callback not set; action ${actionGuid} cannot fire`);
      return;
    }
    this.onTriggerAction(actionGuid);
    const runner = this.runners.get(setupGuid);
    Logger.debug(`[pulse] triggered action ${actionGuid} from slot ${runner?.currentSlotIdx ?? '?'}`);
  }

  private broadcastPulseStatus(
    setupGuid: string,
    status: 'started' | 'stopped',
    slotIdx: number,
  ): void {
    if (!this.hubStatus) return;
    const runner = this.runners.get(setupGuid);
    const payload = this.buildPulseStatusPayload(
      setupGuid,
      status,
      slotIdx,
      runner,
    );
    this.hubStatus.broadcastPulseStatus(payload);
  }

  private buildPulseStatusPayload(
    setupGuid: string,
    status: 'started' | 'stopped',
    slotIdx: number,
    runner?: ActivePulseRunner,
  ): HubStatusPulsePayload {
    const setup = runner?.setup ?? this.projectManager.getPulseSetup(setupGuid);
    const bpm = runner?.setup.guid === setupGuid
      ? (runner ? this.getRunnerBpm(runner) : (setup?.bpm ?? 120))
      : (setup?.bpm ?? 120);
    const speed = resolvePulseSetupSpeed(setup);
    const bpmLabel = Number.isFinite(bpm) ? bpm.toFixed(1) : '120.0';
    const slotsTotal = setup?.slots.length ?? 0;
    const name = setup?.name ?? setupGuid;
    const text =
      status === 'started' && slotsTotal > 0
        ? `${name} · slot ${slotIdx + 1}/${slotsTotal} @ ${bpmLabel} BPM`
        : status === 'started'
          ? `${name} @ ${bpmLabel} BPM`
          : `${name} stopped`;
    return {
      kind: 'pulse',
      setupGuid,
      status,
      message: { text },
      data: { bpm, slotIdx, slotsTotal, speed },
    };
  }

  private bucketForSlot(setup: PulseSetup, slotIdx: number) {
    if (slotIdx < 0 || slotIdx >= setup.slots.length) {
      Logger.warn(`[pulse] slot index ${slotIdx} out of range`);
      return undefined;
    }
    const slot = setup.slots[slotIdx];
    if (!slot) {
      Logger.warn(`[pulse] slot ${slotIdx} is undefined`);
      return undefined;
    }
    const bucketGuid = slot.bucket;
    if (typeof bucketGuid !== 'string' || bucketGuid.length === 0) {
      Logger.warn(`[pulse] slot ${slotIdx} has no bucket assigned`);
      return undefined;
    }
    const bucket = this.projectManager.getPulseBucket(bucketGuid);
    if (!bucket) {
      Logger.warn(`[pulse] unknown bucket ${bucketGuid} on slot ${slotIdx}`);
      return undefined;
    }
    return bucket;
  }

  /**
   * Pause the pulse (clears timer but keeps state). Call start() to resume.
   * (Alias for stop() pending controller integration.)
   */
  pause(): void {
    this.stop();
  }

  /**
   * Drop a setup runner (e.g. after delete). Stops ticking if needed.
   */
  removeSetup(setupGuid: string): void {
    if (this.runners.has(setupGuid)) {
      this.stopSetup(setupGuid);
      this.runners.delete(setupGuid);
    }
  }

  isSetupRunning(setupGuid: string): boolean {
    return this.runners.get(setupGuid)?.isRunning ?? false;
  }

  /**
   * Query focused pulse setup guid (project `activePulseGuid`, else first running).
   */
  getActiveSetupGuid(): string | undefined {
    const active = this.projectManager.getActivePulseGuid();
    if (active && this.runners.has(active)) {
      return active;
    }
    for (const [guid, runner] of this.runners) {
      if (runner.isRunning) {
        return guid;
      }
    }
    return active;
  }

  getLiveBpm(_setupGuid?: string): number | undefined {
    if (this.syncSharedLiveBpm !== undefined) {
      return this.syncSharedLiveBpm;
    }
    const guid = _setupGuid ?? this.getActiveSetupGuid();
    if (!guid) return undefined;
    const runner = this.runners.get(guid);
    return runner?.liveBpm;
  }

  /**
   * Query whether any pulse is currently ticking.
   */
  isRunning(): boolean {
    for (const runner of this.runners.values()) {
      if (runner.isRunning) return true;
    }
    return false;
  }

  /** Snapshot capture: actively playing runners only. */
  captureRunnerStates(): SnapshotPulseState[] {
    const states: SnapshotPulseState[] = [];
    for (const guid of this.getRunningSetupGuids()) {
      const runner = this.runners.get(guid);
      if (!runner) continue;
      states.push({
        guid,
        speed: resolvePulseSetupSpeed(runner.setup),
      });
    }
    return states;
  }

  /**
   * Snapshot recall: stop running setups not in `states`, then apply each stored row.
   * Does not restart setups that are already running with the desired state.
   */
  recallSnapshotPulses(states: SnapshotPulseState[], pulseSetupManager: PulseSetupManager): void {
    const storedGuids = new Set(states.map(s => s.guid));
    for (const [guid, runner] of this.runners) {
      if (runner.isRunning && !storedGuids.has(guid)) {
        this.stopSetup(guid);
      }
    }
    for (const state of states) {
      pulseSetupManager.build({
        command: 'setSetupSpeed',
        setupGuid: state.guid,
        speed: state.speed,
      });
      this.syncActiveSetupFromProject();
      const runner = this.runners.get(state.guid);
      if (runner?.isRunning) {
        const setup = this.projectManager.getPulseSetup(state.guid);
        if (setup && runner) {
          runner.setup = setup;
        }
      } else {
        this.ensureSetupRunning(state.guid);
      }
    }
  }

  /** Start ticking when idle; no-op when already running (avoids slot reset). */
  private ensureSetupRunning(guid: string): void {
    const setup = this.projectManager.getPulseSetup(guid);
    if (!setup) {
      Logger.warn(`[pulse] ensureSetupRunning: unknown setup ${guid}`);
      return;
    }
    const existing = this.runners.get(guid);
    if (existing?.isRunning) {
      return;
    }
    if (existing) {
      existing.setup = setup;
      this.projectManager.setActivePulseGuid(guid);
      this.startRunner(guid);
      return;
    }
    this.runners.set(guid, {
      setup,
      isRunning: false,
      currentSlotIdx: 0,
      nextTickAtMs: 0,
      tickTimer: undefined,
      msIntoCurrentTick: 0,
    });
    this.projectManager.setActivePulseGuid(guid);
    this.startRunner(guid);
  }
}
