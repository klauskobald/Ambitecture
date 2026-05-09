import dotenv from 'dotenv';

export interface PluginServerConfig {
  listenPort: number;
  /** Hostname or IP the **browser** uses to reach the plugin HTTP/WS server (LAN IP when surface runs on another machine). */
  publicHost: string;
}

export interface MidiV1Config {
  hubUrl: string;
  guid: string;
  name: string;
  pluginServer: PluginServerConfig;
  /** Hub `register` discovery payload; derived from {@link pluginServer}. */
  discovery: { interfaces: Record<string, { ui: { kind: string; url: string }; ws: { kind: string; url: string } }> };
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

function optionalEnvInt(key: string, fallback: number): number {
  const value = process.env[key];
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  const n = Number.parseInt(value.trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function buildDiscovery(publicHost: string, port: number): MidiV1Config['discovery'] {
  const baseHttp = `http://${publicHost}:${port}`;
  const baseWs = `ws://${publicHost}:${port}`;
  return {
    interfaces: {
      assign: {
        ui: { kind: 'iframe', url: `${baseHttp}/assign.html` },
        ws: { kind: 'direct', url: `${baseWs}/ws` },
      },
    },
  };
}

export function loadConfig(): MidiV1Config {
  dotenv.config();
  const guid = requiredEnv('GUID');
  const publicHost = requiredEnv('PLUGIN_PUBLIC_HOST');
  const listenPort = optionalEnvInt('PLUGIN_LISTEN_PORT', 9870);
  const pluginServer: PluginServerConfig = { listenPort, publicHost };
  return {
    hubUrl: requiredEnv('AMBITECTURE_HUB_URL'),
    guid,
    name: optionalEnv('NAME', guid),
    pluginServer,
    discovery: buildDiscovery(publicHost, listenPort),
  };
}
