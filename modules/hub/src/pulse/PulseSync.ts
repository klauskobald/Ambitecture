import { Logger } from '../Logger';
import { ProjectManager } from '../ProjectManager';
import { PulseManager } from './PulseManager';
import { PulseTapTempoConfig } from './PulseTapTempoConfig';
import { parsePulseSyncProjectConfig } from './PulseSyncConfig';

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
  constructor(
    private readonly config: PulseTapTempoConfig,
    private readonly pulseManager: PulseManager,
    private readonly projectManager: ProjectManager,
    private readonly onPulsesBroadcast: () => void,
  ) { }

  apply(payload: PulseSyncPayload): void {
    const syncProject = parsePulseSyncProjectConfig(
      this.projectManager.getPulsesWirePayload(),
    );
    if (!syncProject.enabled) {
      return;
    }

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

    const receivedAtMs = Date.now();
    const oneWayDelayMs = Math.max(0, (receivedAtMs - payload.sentAtMs) / 2);
    const beatAtHubMs = payload.beatAtMs + oneWayDelayMs;

    const targetBpm = Math.min(
      this.config.maxBpm,
      Math.max(this.config.minBpm, payload.bpm),
    );

    const referenceBpm = this.pulseManager.getReferenceBpmForSyncLerp();
    const fallbackBpm = this.resolveFallbackDurableBpm() ?? targetBpm;
    const currentLiveBpm = referenceBpm ?? fallbackBpm;
    const smoothedBpm = Math.min(
      this.config.maxBpm,
      Math.max(
        this.config.minBpm,
        currentLiveBpm + syncProject.lerp * (targetBpm - currentLiveBpm),
      ),
    );

    this.pulseManager.setSyncSharedLiveBpm(smoothedBpm);

    const restartFromSlotZero =
      (syncProject.restart === 'bar' && payload.kind === 'bar')
      || (syncProject.restart === 'onset' && payload.kind === 'onset');

    if (this.pulseManager.getRunningSetupGuids().length === 0) {
      const setupGuid = this.resolveFocusSetupGuid();
      if (!setupGuid) {
        Logger.warn('[pulse] pulse:sync ignored — no pulse setup to sync');
        return;
      }
      this.ensureRunner(setupGuid);
    }

    if (payload.kind === 'bar') {
      this.pulseManager.applyAlignedSyncToAllRunning(
        smoothedBpm,
        beatAtHubMs,
        SYNC_SCHEDULE_LEAD_MS,
        restartFromSlotZero,
      );
    } else {
      if (restartFromSlotZero) {
        this.pulseManager.resetSlotIndexToZeroOnAllRunning();
      }
      this.pulseManager.updateSyncLiveTempoOnAllRunning(smoothedBpm);
    }

    this.onPulsesBroadcast();
  }

  private resolveFallbackDurableBpm(): number | undefined {
    const focus = this.resolveFocusSetupGuid();
    if (!focus) return undefined;
    return this.projectManager.getPulseSetup(focus)?.bpm;
  }

  private resolveFocusSetupGuid(): string | undefined {
    const active = this.projectManager.getActivePulseGuid();
    if (active && this.projectManager.getPulseSetup(active)) {
      return active;
    }
    const running = this.pulseManager.getRunningSetupGuids();
    if (running.length > 0) {
      return running[0];
    }
    return this.projectManager.getPulsesWirePayload().setups[0]?.guid;
  }

  private ensureRunner(setupGuid: string): void {
    if (this.pulseManager.isSetupRunning(setupGuid)) {
      return;
    }
    if (this.pulseManager.getRunningSetupGuids().length > 0) {
      return;
    }
    this.pulseManager.selectSetupForSync(setupGuid);
  }
}
