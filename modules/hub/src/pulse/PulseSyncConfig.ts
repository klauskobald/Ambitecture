import type { PulsesConfig } from '../ProjectManager';

export type PulseSyncRestartMode = 'never' | 'bar' | 'onset';

export type PulseSyncProjectConfig = {
  restart: PulseSyncRestartMode;
  lerp: number;
};

const DEFAULTS: PulseSyncProjectConfig = {
  restart: 'never',
  lerp: 0.35,
};

function isRestartMode(value: unknown): value is PulseSyncRestartMode {
  return value === 'never' || value === 'bar' || value === 'onset';
}

export function parsePulseSyncProjectConfig(pulses: PulsesConfig | undefined): PulseSyncProjectConfig {
  if (!pulses?.sync || typeof pulses.sync !== 'object' || Array.isArray(pulses.sync)) {
    return { ...DEFAULTS };
  }
  const sync = pulses.sync as Record<string, unknown>;
  const restartRaw = sync['restart'];
  const restart = isRestartMode(restartRaw) ? restartRaw : DEFAULTS.restart;
  const lerpRaw = sync['lerp'];
  const lerp = typeof lerpRaw === 'number' && Number.isFinite(lerpRaw)
    ? Math.min(1, Math.max(0.01, lerpRaw))
    : DEFAULTS.lerp;
  return { restart, lerp };
}
