import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadDeliverConfig } from './loadConfig.js';
import { serveMountPath } from './staticServe.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

function defaultConfigPath() {
  const fromEnv = process.env.DELIVER_CONFIG;
  if (fromEnv && fromEnv.trim() !== '') {
    return path.resolve(process.cwd(), fromEnv.trim());
  }
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--config');
  if (i >= 0 && argv[i + 1]) {
    return path.resolve(process.cwd(), argv[i + 1]);
  }
  return path.join(packageRoot, 'deliver.yml');
}

/**
 * @param {string} pathname
 * @returns {{ mountId: string, remainder: string } | null}
 */
function parseMountPath(pathname) {
  if (!pathname.startsWith('/')) {
    return null;
  }
  const parts = pathname.split('/').filter((p) => p.length > 0);
  if (parts.length === 0) {
    return null;
  }
  const mountId = parts[0];
  const remainder = parts.slice(1).join('/');
  return { mountId, remainder };
}

function main() {
  const configPath = defaultConfigPath();
  let loaded;
  try {
    loaded = loadDeliverConfig(configPath);
  } catch (e) {
    console.error(`deliver: failed to load ${configPath}:`, /** @type {Error} */ (e).message);
    process.exit(1);
  }
  const { config, resolvedMounts } = loaded;
  const mountIds = Object.keys(resolvedMounts).sort((a, b) => b.length - a.length);

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.writeHead(400);
        res.end();
        return;
      }
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      if (pathname === '/' || pathname === '') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.writeHead(200);
        const links = mountIds
          .map(
            (id) =>
              `<li><a href="/${encodeURIComponent(id)}/">${escapeHtml(id)}</a></li>`
          )
          .join('\n');
        res.end(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><title>deliver</title></head><body><p>Mounts:</p><ul>${links}</ul></body></html>`
        );
        return;
      }

      const parsed = parseMountPath(pathname);
      if (!parsed) {
        res.writeHead(404);
        res.end();
        return;
      }

      const { mountId, remainder } = parsed;
      const mount = resolvedMounts[mountId];
      if (!mount) {
        res.writeHead(404);
        res.end();
        return;
      }

      // Redirect /{id} -> /{id}/ so relative URLs in HTML resolve correctly
      const endsWithSlash = pathname.endsWith('/');
      if (!endsWithSlash && remainder === '') {
        res.writeHead(302, { Location: `/${mountId}/` });
        res.end();
        return;
      }

      const decoded = safeDecodePath(remainder);
      if (decoded === null) {
        res.writeHead(400);
        res.end();
        return;
      }

      await serveMountPath(req, res, mount.rootAbs, decoded);
    } catch (e) {
      console.error('deliver: request error', e);
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end();
    }
  });

  server.listen(config.port, config.host, () => {
    console.log(
      `deliver listening on http://${config.host}:${config.port}/ (config: ${configPath})`
    );
  });
}

/**
 * @param {string} s
 */
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {string} urlPath path segments after mount, no leading slash
 * @returns {string | null}
 */
function safeDecodePath(urlPath) {
  try {
    return urlPath
      .split('/')
      .map((seg) => decodeURIComponent(seg))
      .join('/');
  } catch {
    return null;
  }
}

main();
