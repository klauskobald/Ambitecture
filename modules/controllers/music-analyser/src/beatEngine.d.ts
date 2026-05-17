export type BeatSyncEvent = {
  t: number;
  audioT: number;
  bpm: number;
  phaseAdjustMs: number;
  reason: 'onset' | 'bar';
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

export function createBeatEngine(handlers: BeatEngineHandlers): {
  start: () => void;
  stop: () => void;
};
