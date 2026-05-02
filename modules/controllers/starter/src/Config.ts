import dotenv from 'dotenv';

export interface SampleLoopConfig {
  enabled: boolean;
  intentGuid: string;
  intervalMs: number;
  radius: number;
}

export interface ControllerConfig {
  hubUrl: string;
  name: string;
  guid: string;
  location: [number, number];
  sampleLoop: SampleLoopConfig;
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

function parseBoolean(value: string): boolean {
  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false;
    default:
      throw new Error(`Invalid boolean value "${value}"`);
  }
}

function parsePositiveInteger(key: string, fallback: number): number {
  const raw = optionalEnv(key, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

function parsePositiveNumber(key: string, fallback: number): number {
  const raw = optionalEnv(key, String(fallback));
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

  const hubUrl = requiredEnv('AMBITECTURE_HUB_URL');
  const name = requiredEnv('NAME');
  const guid = requiredEnv('GUID');
  const location = parseLocation(optionalEnv('GEO_LOCATION', '0.000 0.000'));
  const enabled = parseBoolean(optionalEnv('SAMPLE_LOOP_ENABLED', 'true'));
  const intentGuid = optionalEnv('SAMPLE_INTENT_GUID', 'color-1');
  const intervalMs = parsePositiveInteger('SAMPLE_LOOP_INTERVAL_MS', 250);
  const radius = parsePositiveNumber('SAMPLE_LOOP_RADIUS', 0.75);

  return {
    hubUrl,
    name,
    guid,
    location,
    sampleLoop: {
      enabled,
      intentGuid,
      intervalMs,
      radius,
    },
  };
}
