import type { ProjectManager, PulseSetup } from '../ProjectManager';
import { Logger } from '../Logger';

type PulseSlot = {
  actions: string[];
};

type ActivePulseRunner = {
  setup: PulseSetup;
  isRunning: boolean;
  currentSlotIdx: number;
  tickIntervalMs: number;
  tickTimer: ReturnType<typeof setInterval> | undefined;
  msIntoCurrentTick: number;
};

/**
 * Hub-side pulse orchestration. Maintains a single active pulse setup with
 * a per-slot action dispatcher. Tick intervals are rescheduled when necessary:
 * - selectSetup: current tick completes, then new setup begins
 * - setBPM: current tick completes, then reschedules with new interval
 */
export class PulseManager {
  private runner?: ActivePulseRunner;
  private onTriggerAction?: (actionGuid: string) => void;

  constructor(private projectManager: ProjectManager) { }

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
   * resets to slot 0. Persists the active pulse guid to the project and starts the pulse.
   */
  selectSetup(guid: string): void {
    const setup = this.projectManager.getPulseSetup(guid);
    if (!setup) {
      Logger.warn(`[pulse] unknown pulse setup ${guid}`);
      return;
    }

    if (this.runner && this.runner.setup.guid === guid) {
      Logger.info(`[pulse] already on setup ${guid}; current tick will complete before any effect`);
      return;
    }

    if (this.runner) {
      if (this.runner.isRunning) {
        Logger.info(`[pulse] selectSetup(${guid}): current pulse completes this tick, then switching`);
        this.runner.setup = setup;
        this.runner.currentSlotIdx = 0;
        this.runner.tickIntervalMs = this.computeTickIntervalMs(setup.bpm, setup.meter);
        this.projectManager.setActivePulseGuid(guid);
        return;
      }
    }

    this.runner = {
      setup,
      isRunning: false,
      currentSlotIdx: 0,
      tickIntervalMs: this.computeTickIntervalMs(setup.bpm, setup.meter),
      tickTimer: undefined,
      msIntoCurrentTick: 0,
    };
    this.projectManager.setActivePulseGuid(guid);
    Logger.info(`[pulse] selected setup ${guid} (${setup.name}, ${setup.bpm} BPM, ${setup.meter} meter)`);
    this.start();
  }

  /**
   * Set BPM on the active setup. Current tick completes, then the new
   * interval is scheduled. No effect if no pulse is active.
   */
  setBPM(bpm: number): void {
    if (!this.runner) {
      Logger.warn('[pulse] setBPM called but no pulse is active');
      return;
    }
    this.runner.setup.bpm = bpm;
    this.runner.tickIntervalMs = this.computeTickIntervalMs(bpm, this.runner.setup.meter);
    Logger.info(`[pulse] BPM set to ${bpm}; current tick completes before new interval`);
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
    if (this.runner.tickTimer !== undefined) {
      clearInterval(this.runner.tickTimer);
      this.runner.tickTimer = undefined;
    }
    this.runner.isRunning = false;
    Logger.info('[pulse] stopped');
  }

  /**
   * Add an action GUID to a slot. Actions are stored as a simple array.
   */
  addSlotAction(slotIdx: number, actionGuid: string): void {
    if (!this.runner) {
      Logger.warn('[pulse] addSlotAction called but no pulse is active');
      return;
    }
    if (slotIdx < 0 || slotIdx >= this.runner.setup.slots.length) {
      Logger.warn(`[pulse] slot index ${slotIdx} out of range`);
      return;
    }

    const slot = this.runner.setup.slots[slotIdx];
    if (!slot) {
      Logger.warn(`[pulse] slot ${slotIdx} is undefined`);
      return;
    }
    if (slot.actions.includes(actionGuid)) {
      Logger.info(`[pulse] action ${actionGuid} already in slot ${slotIdx}`);
      return;
    }

    slot.actions.push(actionGuid);
    Logger.info(`[pulse] added action ${actionGuid} to slot ${slotIdx}`);
  }

  /**
   * Remove an action GUID from a slot.
   */
  removeSlotAction(slotIdx: number, actionGuid: string): void {
    if (!this.runner) {
      Logger.warn('[pulse] removeSlotAction called but no pulse is active');
      return;
    }
    if (slotIdx < 0 || slotIdx >= this.runner.setup.slots.length) {
      Logger.warn(`[pulse] slot index ${slotIdx} out of range`);
      return;
    }

    const slot = this.runner.setup.slots[slotIdx];
    if (!slot) {
      Logger.warn(`[pulse] slot ${slotIdx} is undefined`);
      return;
    }
    const idx = slot.actions.indexOf(actionGuid);
    if (idx === -1) {
      Logger.warn(`[pulse] action ${actionGuid} not in slot ${slotIdx}`);
      return;
    }

    slot.actions.splice(idx, 1);
    Logger.info(`[pulse] removed action ${actionGuid} from slot ${slotIdx}`);
  }

  /**
   * Internal: start the interval tick loop. Uses setInterval for beat-accurate timing.
   */
  private scheduleNextTick(): void {
    if (!this.runner || !this.runner.isRunning) {
      return;
    }

    this.runner.tickTimer = setInterval(() => {
      this.tickRound();
    }, this.runner.tickIntervalMs);
  }

  /**
   * Execute one tick: dispatch all actions in the current slot, advance slot index.
   */
  private tickRound(): void {
    if (!this.runner || !this.runner.isRunning) {
      return;
    }

    const slot = this.runner.setup.slots[this.runner.currentSlotIdx];
    if (slot) {
      for (const actionGuid of slot.actions) {
        this.dispatchActionItem(actionGuid);
      }
    }

    this.runner.currentSlotIdx = (this.runner.currentSlotIdx + 1) % this.runner.setup.slots.length;
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
