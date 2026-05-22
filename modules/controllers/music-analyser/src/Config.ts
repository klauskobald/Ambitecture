import dotenv from 'dotenv';
import type { BeatEngineOptions } from './beatEngine';
import { loadBeatEngineConfig } from './beatEngineConfig';

export interface MusicAnalyserConfig {
  hubUrl: string;
  guid: string;
  name: string;
  location: [number, number];
  /** Fallback when project YAML has no transmit.minIntervalSeconds */
  transmitMinIntervalSeconds: number;
  beatEngine: BeatEngineOptions;
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

export function loadConfig(): MusicAnalyserConfig {
  dotenv.config();

  return {
    hubUrl: requiredEnv('AMBITECTURE_HUB_URL'),
    guid: requiredEnv('GUID'),
    name: optionalEnv('NAME', requiredEnv('GUID')),
    location: parseLocation(optionalEnv('GEO_LOCATION', '0 0')),
    transmitMinIntervalSeconds: parsePositiveNumber(
      'TRANSMIT_MIN_INTERVAL_SECONDS',
      optionalEnv('TRANSMIT_MIN_INTERVAL_SECONDS', '4'),
    ),
    beatEngine: loadBeatEngineConfig(),
  };
}
