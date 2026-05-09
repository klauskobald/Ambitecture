import dotenv from 'dotenv';

export interface MidiV1Config {
  hubUrl: string;
  guid: string;
  name: string;
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

export function loadConfig(): MidiV1Config {
  dotenv.config();
  const guid = requiredEnv('GUID');
  return {
    hubUrl: requiredEnv('AMBITECTURE_HUB_URL'),
    guid,
    name: optionalEnv('NAME', guid),
  };
}
