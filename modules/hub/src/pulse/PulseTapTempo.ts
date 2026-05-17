import { Logger } from '../Logger';
import { ProjectManager } from '../ProjectManager';
import { PulseManager } from './PulseManager';
import { PulseSetupManager } from './PulseSetupManager';
import { PulseTapTempoConfig } from './PulseTapTempoConfig';

type TapState = {
  setupGuid: string;
  timestamps: number[];
  persistTimer: ReturnType<typeof setTimeout> | undefined;
};

export class PulseTapTempo {
  private state?: TapState;

  constructor(
    private config: PulseTapTempoConfig,
    private pulseManager: PulseManager,
    private pulseSetupManager: PulseSetupManager,
    private projectManager: ProjectManager,
    private onPersisted: () => void,
  ) { }

  recordTap(setupGuid: string, atMs?: number): void {
    if (setupGuid.length === 0) {
      Logger.warn('[pulse] recordTap: empty setupGuid');
      return;
    }
    const setup = this.projectManager.getPulseSetup(setupGuid);
    if (!setup) {
      Logger.warn(`[pulse] recordTap: unknown setup ${setupGuid}`);
      return;
    }

    const activeGuid = this.pulseManager.getActiveSetupGuid();
    if (activeGuid !== setupGuid) {
      this.pulseManager.selectSetup(setupGuid);
    }

    const now = atMs ?? Date.now();
    if (!this.state || this.state.setupGuid !== setupGuid) {
      this.clearPersistTimer();
      this.state = { setupGuid, timestamps: [now], persistTimer: undefined };
      return;
    }

    this.state.timestamps.push(now);
    const cutoff = now - this.config.windowMs;
    this.state.timestamps = this.state.timestamps.filter(t => t >= cutoff);

    if (this.state.timestamps.length < this.config.minTaps) {
      return;
    }

    const intervals: number[] = [];
    for (let i = 1; i < this.state.timestamps.length; i += 1) {
      const delta = this.state.timestamps[i]! - this.state.timestamps[i - 1]!;
      if (delta > 0) {
        intervals.push(delta);
      }
    }
    if (intervals.length === 0) {
      return;
    }

    const meanIntervalMs =
      intervals.reduce((sum, n) => sum + n, 0) / intervals.length;
    let targetBpm = (60000 / meanIntervalMs);
    targetBpm = Math.min(this.config.maxBpm, Math.max(this.config.minBpm, targetBpm));

    const fresh = this.projectManager.getPulseSetup(setupGuid);
    const currentBpm = fresh?.bpm ?? setup.bpm;
    const smoothed =
      currentBpm + this.config.smoothing * (targetBpm - currentBpm);
    const nextBpm = Math.min(
      this.config.maxBpm,
      Math.max(this.config.minBpm, smoothed),
    );

    this.pulseManager.setBPM(nextBpm);
    this.schedulePersist(setupGuid, nextBpm);
  }

  private schedulePersist(setupGuid: string, bpm: number): void {
    if (!this.state) return;
    this.clearPersistTimer();
    this.state.persistTimer = setTimeout(() => {
      this.state!.persistTimer = undefined;
      const result = this.pulseSetupManager.build({
        command: 'setSetupBpm',
        setupGuid,
        bpm,
      });
      if (result.pulsesChanged) {
        this.pulseManager.syncActiveSetupFromProject();
        this.onPersisted();
      }
    }, this.config.persistDebounceMs);
  }

  private clearPersistTimer(): void {
    if (this.state?.persistTimer !== undefined) {
      clearTimeout(this.state.persistTimer);
      this.state.persistTimer = undefined;
    }
  }
}
