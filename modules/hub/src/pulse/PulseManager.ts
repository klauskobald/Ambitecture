import { randomInt } from 'crypto';
import type { ProjectManager, PulseSetup, PulseSlotMode } from '../ProjectManager';
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
 * Hub-side pulse orchestration. Maintains a single active pulse setup with
 * a per-slot action dispatcher. Each slot references one reusable bucket in
 * `pulses.buckets`. One timeout per tick: after each fire, next tick is
 * `Date.now() + 60000/(bpm*speed)` using current BPM and setup {@link PulseSetup.speed}.
 * BPM / speed changes do not touch the pending timer.
 */
export class PulseManager {
  private runner?: ActivePulseRunner;
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
      this.selectSetup(activePulseGuid);
    }
  }

  /**
   * Re-read the active setup and buckets from project YAML after `pulse:assign` / `pulse:control`.
   */
  syncActiveSetupFromProject(): void {
    if (!this.runner) return;
    const guid = this.runner.setup.guid;
    if (!guid) return;
    const setup = this.projectManager.getPulseSetup(guid);
    if (!setup) {
      Logger.warn(`[pulse] syncActiveSetupFromProject: setup ${guid} no longer exists`);
      return;
    }
    this.runner.setup = setup;
    if (this.runner.currentSlotIdx >= setup.slots.length) {
      this.runner.currentSlotIdx = 0;
    }
  }

  private getRunnerBpm(): number {
    if (!this.runner) {
      return 120;
    }
    const live = this.runner.liveBpm;
    if (typeof live === 'number' && Number.isFinite(live)) {
      return live;
    }
    return this.runner.setup.bpm;
  }

  private resolveActiveSetup(): PulseSetup | undefined {
    if (!this.runner) return undefined;
    const guid = this.runner.setup.guid;
    if (!guid) return undefined;
    return this.projectManager.getPulseSetup(guid);
  }

  getStatusSnapshot(): HubStatusPulsePayload | undefined {
    if (!this.runner || !this.runner.isRunning) {
      return undefined;
    }
    const setup = this.runner.setup;
    const setupGuid = setup.guid ?? '';
    if (!setupGuid) return undefined;
    return this.buildPulseStatusPayload(setupGuid, 'started', this.runner.currentSlotIdx);
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
   * Activate a pulse setup by guid. The current pulse (if running) completes
   * its current tick before the new setup takes over. If already on this setup,
   * restarts from slot 0. Persists the active pulse guid to the project and starts the pulse.
   */
  selectSetup(guid: string): void {
    const setup = this.projectManager.getPulseSetup(guid);
    if (!setup) {
      Logger.warn(`[pulse] unknown pulse setup ${guid}`);
      return;
    }

    const syncCarryBpmEnabled = parsePulseSyncProjectConfig(
      this.projectManager.getPulsesWirePayload(),
    ).enabled;

    if (this.runner && this.runner.setup.guid === guid) {
      this.restartActiveSetup();
      return;
    }

    if (this.runner) {
      if (this.runner.isRunning) {
        Logger.info(`[pulse] selectSetup(${guid}): switching active pulse`);
        const carryBpm = syncCarryBpmEnabled ? this.getRunnerBpm() : undefined;
        this.stopTimer();
        this.runner.setup = setup;
        this.runner.currentSlotIdx = 0;
        this.runner.isRunning = true;
        if (
          syncCarryBpmEnabled
          && carryBpm !== undefined
          && Number.isFinite(carryBpm)
        ) {
          this.runner.liveBpm = carryBpm;
        }
        this.projectManager.setActivePulseGuid(guid);
        this.scheduleNextTick();
        return;
      }
    }

    const carryBpmForStoppedRunner =
      syncCarryBpmEnabled && this.runner ? this.getRunnerBpm() : undefined;

    this.runner = {
      setup,
      isRunning: false,
      currentSlotIdx: 0,
      nextTickAtMs: 0,
      tickTimer: undefined,
      msIntoCurrentTick: 0,
      ...(carryBpmForStoppedRunner !== undefined && Number.isFinite(carryBpmForStoppedRunner)
        ? { liveBpm: carryBpmForStoppedRunner }
        : {}),
    };
    this.projectManager.setActivePulseGuid(guid);
    Logger.info(`[pulse] selected setup ${guid} (${setup.name}, ${setup.bpm} BPM, ${setup.meter} meter)`);
    this.start();
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

    this.stopTimer();
    this.runner = {
      setup,
      isRunning: false,
      currentSlotIdx: 0,
      nextTickAtMs: 0,
      tickTimer: undefined,
      msIntoCurrentTick: 0,
    };
    this.projectManager.setActivePulseGuid(guid);
    Logger.info(`[pulse] selected setup for sync ${guid} (${setup.name})`);
  }

  /**
   * Set BPM and schedule the next tick at an absolute wall-clock time (phase-aligned sync).
   */
  applyAlignedSync(bpm: number, nextTickAtMs: number, restartFromSlotZero = false): void {
    if (!this.runner) {
      Logger.warn('[pulse] applyAlignedSync called but no pulse is active');
      return;
    }
    const setup = this.projectManager.getPulseSetup(this.runner.setup.guid ?? '');
    if (setup) {
      this.runner.setup = setup;
    }
    this.runner.liveBpm = bpm;
    this.runner.isRunning = true;
    if (restartFromSlotZero) {
      this.runner.currentSlotIdx = 0;
      this.runner.msIntoCurrentTick = 0;
    }
    Logger.info(
      `[pulse] aligned sync BPM=${bpm} nextTick in ${Math.max(0, nextTickAtMs - Date.now())}ms`
        + (restartFromSlotZero ? ' (slot 0)' : ''),
    );
    this.scheduleTickAt(nextTickAtMs);
  }

  /**
   * Update live analyser tempo; does not reschedule the pending tick.
   */
  updateLiveTempo(bpm: number): void {
    if (!this.runner) {
      Logger.warn('[pulse] updateLiveTempo called but no pulse is active');
      return;
    }
    const setup = this.projectManager.getPulseSetup(this.runner.setup.guid ?? '');
    if (setup) {
      this.runner.setup = setup;
    }
    this.runner.liveBpm = bpm;
    const periodMs = this.computeTickIntervalMs(bpm, this.runner.setup);
    Logger.info(`[pulse] live tempo ${bpm} BPM (${periodMs}ms/tick, timer unchanged)`);
  }

  /**
   * Reset slot cursor only (e.g. onset restart policy) without stopping the tick chain.
   */
  resetSlotIndexToZero(): void {
    if (!this.runner) return;
    this.runner.currentSlotIdx = 0;
    this.runner.msIntoCurrentTick = 0;
  }

  private restartActiveSetup(): void {
    if (!this.runner) return;
    this.stopTimer();
    this.runner.currentSlotIdx = 0;
    this.runner.msIntoCurrentTick = 0;
    this.runner.isRunning = true;
    this.scheduleNextTick();
    Logger.info(`[pulse] restarted setup ${this.runner.setup.guid ?? '?'}`);
  }

  /**
   * Set BPM on the active setup. Does not reschedule the pending tick.
   */
  setBPM(bpm: number): void {
    if (!this.runner) {
      Logger.warn('[pulse] setBPM called but no pulse is active');
      return;
    }
    const setup = this.projectManager.getPulseSetup(this.runner.setup.guid ?? '');
    if (setup) {
      this.runner.setup = setup;
    }
    this.runner.setup.bpm = bpm;
    delete this.runner.liveBpm;
    Logger.info(`[pulse] BPM set to ${bpm}`);
  }

  /**
   * Set meter (beats per measure) on the active setup.
   */
  setMeter(meter: number): void {
    if (!this.runner) {
      Logger.warn('[pulse] setMeter called but no pulse is active');
      return;
    }
    this.runner.setup.meter = meter;
    Logger.info(`[pulse] meter set to ${meter}`);
  }

  /**
   * Start pulse ticking. If already running, this is a no-op.
   */
  start(): void {
    if (!this.runner) {
      Logger.warn('[pulse] start called but no pulse is selected');
      return;
    }
    if (this.runner.isRunning) {
      Logger.info('[pulse] already running');
      return;
    }

    const setup = this.projectManager.getPulseSetup(this.runner.setup.guid ?? '');
    if (setup) {
      this.runner.setup = setup;
    }

    this.runner.isRunning = true;
    this.runner.currentSlotIdx = 0;
    this.runner.msIntoCurrentTick = 0;

    const periodMs = this.computeTickIntervalMs(this.getRunnerBpm(), this.runner.setup);
    Logger.info(`[pulse] started (${this.runner.setup.name}, ${periodMs}ms/tick)`);
    this.scheduleNextTick();
  }

  /**
   * Stop pulse ticking. Clears any pending timer.
   */
  stop(): void {
    if (!this.runner) {
      Logger.warn('[pulse] stop called but no pulse is active');
      return;
    }
    this.stopTimer();
    this.runner.isRunning = false;
    this.broadcastPulseStatus('stopped', this.runner.currentSlotIdx);
    Logger.info('[pulse] stopped');
  }

  private stopTimer(): void {
    if (!this.runner) return;
    if (this.runner.tickTimer !== undefined) {
      clearTimeout(this.runner.tickTimer);
      this.runner.tickTimer = undefined;
    }
  }

  /**
   * Wait until {@link nextTickAtMs}, then fire one tick and schedule the next from current BPM.
   */
  private scheduleTickAt(nextTickAtMs: number): void {
    if (!this.runner || !this.runner.isRunning) {
      return;
    }

    this.stopTimer();
    this.runner.nextTickAtMs = nextTickAtMs;
    const delayMs = Math.max(0, nextTickAtMs - Date.now());
    this.runner.tickTimer = setTimeout(() => {
      this.onTickTimerFired();
    }, delayMs);
  }

  private onTickTimerFired(): void {
    if (!this.runner || !this.runner.isRunning) {
      return;
    }
    this.runner.tickTimer = undefined;
    this.tickRound();
    const periodMs = this.computeTickIntervalMs(
      this.getRunnerBpm(),
      this.runner.setup,
    );
    this.scheduleTickAt(Date.now() + periodMs);
  }

  private computeNextTickAtMsFromNow(): number {
    if (!this.runner) {
      return Date.now();
    }
    const periodMs = this.computeTickIntervalMs(
      this.getRunnerBpm(),
      this.runner.setup,
    );
    return Date.now() + periodMs;
  }

  /**
   * Add an action GUID to the bucket assigned to a slot.
   */
  addSlotAction(slotIdx: number, actionGuid: string): void {
    if (!this.runner) {
      Logger.warn('[pulse] addSlotAction called but no pulse is active');
      return;
    }
    const bucket = this.bucketForSlot(this.runner.setup, slotIdx);
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
  removeSlotAction(slotIdx: number, actionGuid: string): void {
    if (!this.runner) {
      Logger.warn('[pulse] removeSlotAction called but no pulse is active');
      return;
    }
    const bucket = this.bucketForSlot(this.runner.setup, slotIdx);
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
  private scheduleNextTick(): void {
    if (!this.runner || !this.runner.isRunning) {
      return;
    }

    this.stopTimer();
    this.tickRound();
    this.scheduleTickAt(this.computeNextTickAtMsFromNow());
  }

  /**
   * Execute one tick: dispatch all actions in the current slot's bucket, advance slot index.
   */
  private tickRound(): void {
    if (!this.runner || !this.runner.isRunning) {
      return;
    }

    const setup = this.resolveActiveSetup();
    if (!setup) {
      return;
    }
    this.runner.setup = setup;

    const slotIdx = this.runner.currentSlotIdx;
    const slot = setup.slots[slotIdx];
    if (slot?.active === true) {
      const actionGuids = this.projectManager.getPulseSlotActionGuids(setup, slotIdx);
      for (const actionGuid of actionGuids) {
        this.dispatchActionItem(actionGuid);
      }
    }

    this.broadcastPulseStatus('started', slotIdx);

    const slotsTotal = setup.slots.length;
    this.runner.currentSlotIdx = this.advanceSlotIdx(setup, slotIdx);
    this.runner.msIntoCurrentTick = 0;
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
  private dispatchActionItem(actionGuid: string): void {
    if (!this.onTriggerAction) {
      Logger.warn(`[pulse] action trigger callback not set; action ${actionGuid} cannot fire`);
      return;
    }
    this.onTriggerAction(actionGuid);
    Logger.debug(`[pulse] triggered action ${actionGuid} from slot ${this.runner?.currentSlotIdx ?? '?'}`);
  }

  private broadcastPulseStatus(status: 'started' | 'stopped', slotIdx: number): void {
    if (!this.hubStatus || !this.runner) return;
    const setupGuid = this.runner.setup.guid ?? '';
    if (!setupGuid) return;
    const payload = this.buildPulseStatusPayload(setupGuid, status, slotIdx);
    this.hubStatus.broadcastPulseStatus(payload);
  }

  private buildPulseStatusPayload(
    setupGuid: string,
    status: 'started' | 'stopped',
    slotIdx: number,
  ): HubStatusPulsePayload {
    const setup = this.runner?.setup ?? this.projectManager.getPulseSetup(setupGuid);
    const bpm = this.runner?.setup.guid === setupGuid
      ? this.getRunnerBpm()
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
   * Query active pulse setup guid, or undefined if none.
   */
  getActiveSetupGuid(): string | undefined {
    return this.runner?.setup.guid;
  }

  getLiveBpm(): number | undefined {
    return this.runner?.liveBpm;
  }

  /**
   * Query whether the pulse is currently ticking.
   */
  isRunning(): boolean {
    return this.runner?.isRunning ?? false;
  }
}
