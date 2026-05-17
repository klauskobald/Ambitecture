import type { ProjectManager, PulseSetup } from '../ProjectManager';
import { Logger } from '../Logger';
import type { HubStatusDispatcher, HubStatusPulsePayload } from '../hubStatusTypes';

type ActivePulseRunner = {
  setup: PulseSetup;
  isRunning: boolean;
  currentSlotIdx: number;
  tickIntervalMs: number;
  tickTimer: ReturnType<typeof setInterval> | undefined;
  alignTimeout: ReturnType<typeof setTimeout> | undefined;
  msIntoCurrentTick: number;
};

/**
 * Hub-side pulse orchestration. Maintains a single active pulse setup with
 * a per-slot action dispatcher. Each slot references one reusable bucket in
 * `pulses.buckets`. Tick intervals are rescheduled when necessary:
 * - selectSetup: stops prior timer, fires slot 0 immediately, then interval loop
 * - setBPM: reschedules interval and fires current slot immediately
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
    this.runner.tickIntervalMs = this.computeTickIntervalMs(setup.bpm, setup.meter);
    if (this.runner.currentSlotIdx >= setup.slots.length) {
      this.runner.currentSlotIdx = 0;
    }
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
   * Compute milliseconds per tick based on BPM and meter.
   * Quarter note = 1 beat; meter is beats per measure.
   * Tick = one slot = one quarter note = (60000 / BPM) ms.
   */
  private computeTickIntervalMs(bpm: number, _meter: number): number {
    return Math.round(60000 / bpm);
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

    if (this.runner && this.runner.setup.guid === guid) {
      this.restartActiveSetup();
      return;
    }

    if (this.runner) {
      if (this.runner.isRunning) {
        Logger.info(`[pulse] selectSetup(${guid}): switching active pulse`);
        this.stopTimer();
        this.runner.setup = setup;
        this.runner.currentSlotIdx = 0;
        this.runner.tickIntervalMs = this.computeTickIntervalMs(setup.bpm, setup.meter);
        this.runner.isRunning = true;
        this.runner.alignTimeout = undefined;
        this.projectManager.setActivePulseGuid(guid);
        this.scheduleNextTick();
        return;
      }
    }

    this.runner = {
      setup,
      isRunning: false,
      currentSlotIdx: 0,
      tickIntervalMs: this.computeTickIntervalMs(setup.bpm, setup.meter),
      tickTimer: undefined,
      alignTimeout: undefined,
      msIntoCurrentTick: 0,
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
      tickIntervalMs: this.computeTickIntervalMs(setup.bpm, setup.meter),
      tickTimer: undefined,
      alignTimeout: undefined,
      msIntoCurrentTick: 0,
    };
    this.projectManager.setActivePulseGuid(guid);
    Logger.info(`[pulse] selected setup for sync ${guid} (${setup.name})`);
  }

  /**
   * Set BPM and schedule the next tick at an absolute wall-clock time (phase-aligned sync).
   */
  applyAlignedSync(bpm: number, nextTickAtMs: number): void {
    if (!this.runner) {
      Logger.warn('[pulse] applyAlignedSync called but no pulse is active');
      return;
    }
    const setup = this.projectManager.getPulseSetup(this.runner.setup.guid ?? '');
    if (setup) {
      this.runner.setup = setup;
    }
    this.runner.setup.bpm = bpm;
    this.runner.tickIntervalMs = this.computeTickIntervalMs(bpm, this.runner.setup.meter);
    this.runner.isRunning = true;
    Logger.info(
      `[pulse] aligned sync BPM=${bpm} nextTick in ${Math.max(0, nextTickAtMs - Date.now())}ms`,
    );
    this.scheduleAlignedTicks(nextTickAtMs);
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
   * Set BPM on the active setup. Reschedules interval when running.
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
    this.runner.tickIntervalMs = this.computeTickIntervalMs(bpm, this.runner.setup.meter);
    Logger.info(`[pulse] BPM set to ${bpm}`);
    if (this.runner.isRunning) {
      this.scheduleNextTick();
    }
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

    Logger.info(`[pulse] started (${this.runner.setup.name}, ${this.runner.tickIntervalMs}ms/tick)`);
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
      clearInterval(this.runner.tickTimer);
      this.runner.tickTimer = undefined;
    }
    if (this.runner.alignTimeout !== undefined) {
      clearTimeout(this.runner.alignTimeout);
      this.runner.alignTimeout = undefined;
    }
  }

  /**
   * Phase-align: wait until {@link nextTickAtMs}, fire one tick, then interval at tickIntervalMs.
   */
  private scheduleAlignedTicks(nextTickAtMs: number): void {
    if (!this.runner || !this.runner.isRunning) {
      return;
    }

    this.stopTimer();
    const delayMs = Math.max(0, nextTickAtMs - Date.now());
    this.runner.alignTimeout = setTimeout(() => {
      if (!this.runner || !this.runner.isRunning) {
        return;
      }
      this.runner.alignTimeout = undefined;
      this.tickRound();
      this.runner.tickTimer = setInterval(() => {
        this.tickRound();
      }, this.runner.tickIntervalMs);
    }, delayMs);
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

  /**
   * Fire the current slot immediately, then schedule repeating ticks at tickIntervalMs.
   */
  private scheduleNextTick(): void {
    if (!this.runner || !this.runner.isRunning) {
      return;
    }

    this.stopTimer();
    this.tickRound();
    this.runner.tickTimer = setInterval(() => {
      this.tickRound();
    }, this.runner.tickIntervalMs);
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
    this.runner.currentSlotIdx =
      slotsTotal > 0 ? (slotIdx + 1) % slotsTotal : 0;
    this.runner.msIntoCurrentTick = 0;
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
    const bpm = setup?.bpm ?? 120;
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
      data: { bpm, slotIdx, slotsTotal },
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

  /**
   * Query whether the pulse is currently ticking.
   */
  isRunning(): boolean {
    return this.runner?.isRunning ?? false;
  }
}
