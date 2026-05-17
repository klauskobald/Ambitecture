import { Logger } from '../Logger';
import { ProjectManager } from '../ProjectManager';
import { PulseManager } from './PulseManager';
import { PulseSetupManager } from './PulseSetupManager';
import { PulseTapTempoConfig } from './PulseTapTempoConfig';

export type PulseSyncKind = 'onset' | 'bar';

export type PulseSyncPayload = {
  bpm: number;
  beatAtMs: number;
  sentAtMs: number;
  kind: PulseSyncKind;
  phaseAdjustMs?: number;
  audioT?: number;
  spectrum?: number[];
};

const SYNC_SCHEDULE_LEAD_MS = 30;
const ONSET_PHASE_RESCHEDULE_MAX_MS = 50;

export class PulseSync {
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingSetupGuid?: string;
  private pendingBpm?: number;

  constructor(
    private readonly config: PulseTapTempoConfig,
    private readonly pulseManager: PulseManager,
    private readonly pulseSetupManager: PulseSetupManager,
    private readonly projectManager: ProjectManager,
    private readonly onPersisted: () => void,
  ) { }

  apply(payload: PulseSyncPayload): void {
    if (!Number.isFinite(payload.bpm) || payload.bpm <= 0) {
      Logger.warn('[pulse] pulse:sync ignored — invalid bpm');
      return;
    }
    if (!Number.isFinite(payload.beatAtMs) || !Number.isFinite(payload.sentAtMs)) {
      Logger.warn('[pulse] pulse:sync ignored — invalid timestamps');
      return;
    }

    if (payload.kind === 'onset') {
      const phaseMs = Math.abs(payload.phaseAdjustMs ?? Number.POSITIVE_INFINITY);
      if (phaseMs > ONSET_PHASE_RESCHEDULE_MAX_MS) {
        return;
      }
    }

    const setupGuid = this.resolveSetupGuid();
    if (!setupGuid) {
      Logger.warn('[pulse] pulse:sync ignored — no pulse setup to sync');
      return;
    }

    const receivedAtMs = Date.now();
    const oneWayDelayMs = Math.max(0, (receivedAtMs - payload.sentAtMs) / 2);
    const beatAtHubMs = payload.beatAtMs + oneWayDelayMs;

    const targetBpm = Math.min(
      this.config.maxBpm,
      Math.max(this.config.minBpm, payload.bpm),
    );

    const setup = this.projectManager.getPulseSetup(setupGuid);
    const currentBpm = setup?.bpm ?? targetBpm;
    const smoothedBpm = Math.min(
      this.config.maxBpm,
      Math.max(
        this.config.minBpm,
        currentBpm + this.config.smoothing * (targetBpm - currentBpm),
      ),
    );

    const periodMs = 60000 / smoothedBpm;
    let beatIndex = Math.ceil(
      (receivedAtMs + SYNC_SCHEDULE_LEAD_MS - beatAtHubMs) / periodMs,
    );
    if (!Number.isFinite(beatIndex) || beatIndex < 0) {
      beatIndex = 0;
    }
    const nextTickAtMs = beatAtHubMs + beatIndex * periodMs;

    this.ensureRunner(setupGuid);
    this.pulseManager.applyAlignedSync(smoothedBpm, nextTickAtMs);
    this.schedulePersist(setupGuid, smoothedBpm);
  }

  private resolveSetupGuid(): string | undefined {
    const runnerGuid = this.pulseManager.getActiveSetupGuid();
    if (runnerGuid) {
      return runnerGuid;
    }
    return this.projectManager.getActivePulseGuid();
  }

  private ensureRunner(setupGuid: string): void {
    const activeGuid = this.pulseManager.getActiveSetupGuid();
    if (activeGuid === setupGuid) {
      return;
    }
    this.pulseManager.selectSetupForSync(setupGuid);
  }

  private schedulePersist(setupGuid: string, bpm: number): void {
    this.pendingSetupGuid = setupGuid;
    this.pendingBpm = bpm;
    if (this.persistTimer !== undefined) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      const guid = this.pendingSetupGuid;
      const nextBpm = this.pendingBpm;
      if (!guid || nextBpm === undefined) {
        return;
      }
      const result = this.pulseSetupManager.build({
        command: 'setSetupBpm',
        setupGuid: guid,
        bpm: nextBpm,
      });
      if (result.pulsesChanged) {
        this.pulseManager.syncActiveSetupFromProject();
        this.onPersisted();
      }
    }, this.config.persistDebounceMs);
  }
}
