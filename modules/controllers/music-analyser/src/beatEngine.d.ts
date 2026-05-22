export type BeatSyncEvent = {
  t: number;
  audioT: number;
  bpm: number;
  phaseAdjustMs: number;
  reason: 'onset' | 'bar';
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
};

export type BeatEngineHandlers = {
  onSync: (event: BeatSyncEvent) => void;
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
