import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { mimeForFilePath } from './mime.js';
import { assertRealPathInsideRoot, assertSafeRelativePath, joinUnderRoot } from './pathSafe.js';

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} rootAbs
 * @param {string} urlRelPath decoded path after /{mountId}/ (may be empty)
 */
export async function serveMountPath(req, res, rootAbs, urlRelPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }

  let rel;
  try {
    rel = assertSafeRelativePath(urlRelPath);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }

  let fileAbs;
  try {
    fileAbs = joinUnderRoot(rootAbs, rel);
  } catch {
    res.writeHead(403);
    res.end();
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(fileAbs);
  } catch {
    res.writeHead(404);
    res.end();
    return;
  }

  if (stat.isDirectory()) {
    const indexPath = path.join(fileAbs, 'index.html');
    let indexStat;
    try {
      indexStat = await fsp.stat(indexPath);
    } catch {
      res.writeHead(404);
      res.end();
      return;
    }
    if (!indexStat.isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    await sendFile(req, res, rootAbs, indexPath);
    return;
  }

  if (!stat.isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }

  await sendFile(req, res, rootAbs, fileAbs);
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} rootAbs
 * @param {string} fileAbs
 */
async function sendFile(req, res, rootAbs, fileAbs) {
  let realFile;
  try {
    realFile = assertRealPathInsideRoot(rootAbs, fileAbs);
  } catch (e) {
    if (/** @type {Error} */ (e).message === 'not found') {
      res.writeHead(404);
    } else {
      res.writeHead(403);
    }
    res.end();
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(realFile);
  } catch {
    res.writeHead(404);
    res.end();
    return;
  }
  if (!stat.isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }

  const mime = mimeForFilePath(realFile);
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Length', String(stat.size));
  res.writeHead(200);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  await pipeline(fs.createReadStream(realFile), res);
}
