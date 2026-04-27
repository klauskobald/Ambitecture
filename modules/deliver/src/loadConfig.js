import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

/**
 * @typedef {{ root: string, entry?: string }} MountConfig
 * @typedef {{ host: string, port: number, mounts: Record<string, MountConfig> }} DeliverConfig
 */

/**
 * @param {unknown} raw
 * @returns {DeliverConfig}
 */
export function parseDeliverConfig(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('deliver.yml: root must be a mapping');
  }
  /** @type {Record<string, unknown>} */
  const doc = /** @type {Record<string, unknown>} */ (raw);

  const listenRaw = doc.listen;
  let host = '127.0.0.1';
  let port = 8080;
  if (listenRaw !== undefined) {
    if (listenRaw === null || typeof listenRaw !== 'object' || Array.isArray(listenRaw)) {
      throw new Error('deliver.yml: listen must be a mapping');
    }
    const l = /** @type {Record<string, unknown>} */ (listenRaw);
    if (l.host !== undefined) {
      if (typeof l.host !== 'string' || l.host.trim() === '') {
        throw new Error('deliver.yml: listen.host must be a non-empty string');
      }
      host = l.host.trim();
    }
    if (l.port !== undefined) {
      if (typeof l.port !== 'number' || !Number.isInteger(l.port) || l.port < 1 || l.port > 65535) {
        throw new Error('deliver.yml: listen.port must be an integer 1–65535');
      }
      port = l.port;
    }
  }

  const mountsRaw = doc.mounts;
  if (mountsRaw === null || typeof mountsRaw !== 'object' || Array.isArray(mountsRaw)) {
    throw new Error('deliver.yml: mounts must be a mapping');
  }
  /** @type {Record<string, MountConfig>} */
  const mounts = {};
  for (const [id, spec] of Object.entries(mountsRaw)) {
    if (id === '' || id.includes('/') || id.includes('\\')) {
      throw new Error(`deliver.yml: invalid mount id "${id}"`);
    }
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new Error(`deliver.yml: mounts.${id} must be a mapping`);
    }
    const s = /** @type {Record<string, unknown>} */ (spec);
    if (typeof s.root !== 'string' || s.root.trim() === '') {
      throw new Error(`deliver.yml: mounts.${id}.root must be a non-empty string`);
    }
    const entry = s.entry;
    if (entry !== undefined && (typeof entry !== 'string' || entry.trim() === '')) {
      throw new Error(`deliver.yml: mounts.${id}.entry must be a non-empty string when set`);
    }
    mounts[id] = {
      root: s.root.trim(),
      ...(entry !== undefined ? { entry: /** @type {string} */ (entry).trim() } : {}),
    };
  }
  if (Object.keys(mounts).length === 0) {
    throw new Error('deliver.yml: mounts must define at least one mount');
  }
  return { host, port, mounts };
}

/**
 * @param {string} configPath absolute path to deliver.yml
 * @returns {{ config: DeliverConfig, configDir: string, resolvedMounts: Record<string, { rootAbs: string, entry?: string }> }}
 */
export function loadDeliverConfig(configPath) {
  const abs = path.resolve(configPath);
  const text = fs.readFileSync(abs, 'utf8');
  const raw = yaml.load(text);
  const config = parseDeliverConfig(raw);
  const configDir = path.dirname(abs);
  /** @type {Record<string, { rootAbs: string, entry?: string }>} */
  const resolvedMounts = {};
  for (const [id, m] of Object.entries(config.mounts)) {
    const rootAbs = path.resolve(configDir, m.root);
    if (!fs.existsSync(rootAbs) || !fs.statSync(rootAbs).isDirectory()) {
      throw new Error(`deliver.yml: mounts.${id}.root is not a directory: ${rootAbs}`);
    }
    resolvedMounts[id] = { rootAbs, ...(m.entry !== undefined ? { entry: m.entry } : {}) };
  }
  return { config, configDir, resolvedMounts };
}
