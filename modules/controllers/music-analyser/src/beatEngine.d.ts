export type BeatSyncEvent = {
  t: number;
  audioT: number;
  bpm: number;
  phaseAdjustMs: number;
  reason: 'onset' | 'bar';
};

export type AudioLevelEvent = {
  rms: number;
  smoothed: number;
  threshold: number;
  silent: boolean;
  belowThresholdMs: number;
};

export type BeatEngineOptions = {
  syncToleranceSec: number;
  onsetMinGapSec: number;
  onsetFluxWindow: number;
  onsetFluxSigma: number;
  odfBufferDurationSec: number;
  bpmUpdateIntervalMs: number;
  syncBarBeats: number;
  initialBpm: number;
  bpmMin: number;
  bpmMax: number;
  bpmSmoothNewWeight: number;
  /** RMS below this (0–1) treats input as silent. */
  audioSilenceThreshold: number;
  /** BPM sent on pulse:sync while input is below {@link audioSilenceThreshold}. */
  silentBpm: number;
  /** Seconds below threshold before entering silent mode. */
  silenceTimeoutSec: number;
};

export type BeatEngineHandlers = {
  onSync: (event: BeatSyncEvent) => void;
  onAudioLevel?: (event: AudioLevelEvent) => void;
  onBeat?: (event: {
    t: number;
    audioT: number;
    beat: number;
    bpm: number;
    source: string;
  }) => void;
  onBpm?: (event: {
    t: number;
    audioT: number;
    bpm: number;
    prevBpm: number;
  }) => void;
  onError?: (err: Error) => void;
};

export function createBeatEngine(
  handlers: BeatEngineHandlers,
  options?: Partial<BeatEngineOptions>,
): {
  start: () => void;
  stop: () => void;
};
