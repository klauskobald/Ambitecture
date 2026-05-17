export type PulseTapTempoConfig = {
  minBpm: number;
  maxBpm: number;
  minTaps: number;
  windowMs: number;
  smoothing: number;
  persistDebounceMs: number;
};

const DEFAULTS: PulseTapTempoConfig = {
  minBpm: 20,
  maxBpm: 300,
  minTaps: 2,
  windowMs: 2500,
  smoothing: 0.35,
  persistDebounceMs: 400,
};

export function parsePulseTapTempoConfig(raw: unknown): PulseTapTempoConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULTS };
  }
  const root = raw as Record<string, unknown>;
  const tap = root['tapTempo'];
  if (!tap || typeof tap !== 'object' || Array.isArray(tap)) {
    return { ...DEFAULTS };
  }
  const t = tap as Record<string, unknown>;
  const num = (key: keyof PulseTapTempoConfig, fallback: number): number => {
    const v = t[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  };
  return {
    minBpm: Math.round(num('minBpm', DEFAULTS.minBpm)),
    maxBpm: Math.round(num('maxBpm', DEFAULTS.maxBpm)),
    minTaps: Math.max(1, Math.round(num('minTaps', DEFAULTS.minTaps))),
    windowMs: Math.max(100, Math.round(num('windowMs', DEFAULTS.windowMs))),
    smoothing: Math.min(1, Math.max(0.01, num('smoothing', DEFAULTS.smoothing))),
    persistDebounceMs: Math.max(50, Math.round(num('persistDebounceMs', DEFAULTS.persistDebounceMs))),
  };
}
