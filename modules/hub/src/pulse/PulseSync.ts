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

    const syncProject = parsePulseSyncProjectConfig(
      this.projectManager.getPulsesWirePayload(),
    );

    const setup = this.projectManager.getPulseSetup(setupGuid);
    const durableBpm = setup?.bpm ?? targetBpm;
    const currentLiveBpm = this.pulseManager.getLiveBpm() ?? durableBpm;
    const smoothedBpm = Math.min(
      this.config.maxBpm,
      Math.max(
        this.config.minBpm,
        currentLiveBpm + syncProject.lerp * (targetBpm - currentLiveBpm),
      ),
    );

    const restartFromSlotZero =
      (syncProject.restart === 'bar' && payload.kind === 'bar')
      || (syncProject.restart === 'onset' && payload.kind === 'onset');

    const periodMs = 60000 / smoothedBpm;
    let beatIndex = Math.ceil(
      (receivedAtMs + SYNC_SCHEDULE_LEAD_MS - beatAtHubMs) / periodMs,
    );
    if (!Number.isFinite(beatIndex) || beatIndex < 0) {
      beatIndex = 0;
    }
    const nextTickAtMs = beatAtHubMs + beatIndex * periodMs;

    this.ensureRunner(setupGuid);
    this.pulseManager.applyAlignedSync(smoothedBpm, nextTickAtMs, restartFromSlotZero);
    this.onPulsesBroadcast();
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
}
