import dotenv from 'dotenv';

export interface ControllerConfig {
  hubUrl: string;
  name: string;
  guid: string;
  location: [number, number];
  /** When set, index.ts wires the optional sample runtime loop against this intent. */
  sampleIntentGuid: string | null;
  sampleIntervalMs: number;
  sampleRadius: number;
  /** Hub `register` — receive perform `runtime:update` when true. */
  subscribeRuntime: boolean;
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required environment variable ${key}`);
  }
  return value.trim();
}

function optionalEnv(key: string, fallback: string): string {
  const value = process.env[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function parsePositiveNumber(key: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} must be a positive number`);
  }
  return value;
}

function parseLocation(raw: string): [number, number] {
  const parts = raw.split(/\s+/).map(Number);
  const lon = parts[0];
  const lat = parts[1];
  if (parts.length !== 2 || lon === undefined || lat === undefined || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error('GEO_LOCATION must be two numbers: "lon lat"');
  }
  return [lon, lat];
}

export function loadConfig(): ControllerConfig {
  dotenv.config();

  const sampleIntentGuid = optionalEnv('SAMPLE_INTENT_GUID', '');

  return {
    hubUrl: requiredEnv('AMBITECTURE_HUB_URL'),
    name: requiredEnv('NAME'),
    guid: requiredEnv('GUID'),
    location: parseLocation(optionalEnv('GEO_LOCATION', '0 0')),
    sampleIntentGuid: sampleIntentGuid || null,
    sampleIntervalMs: parsePositiveNumber('SAMPLE_INTERVAL_MS', optionalEnv('SAMPLE_INTERVAL_MS', '40')),
    sampleRadius: parsePositiveNumber('SAMPLE_RADIUS', optionalEnv('SAMPLE_RADIUS', '1')),
    subscribeRuntime: optionalEnv('SUBSCRIBE_RUNTIME', sampleIntentGuid ? 'true' : 'false') === 'true',
  };
}
