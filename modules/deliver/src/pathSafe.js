import fs from 'fs';
import path from 'path';

/**
 * Reject "..", NUL. URL path uses `/`; join with path.join for the current OS.
 * @param {string} relPath path after mount id (no leading slash)
 */
export function assertSafeRelativePath(relPath) {
  if (relPath === '') {
    return '';
  }
  const segments = relPath.split('/');
  const parts = [];
  for (const seg of segments) {
    if (seg === '') {
      continue;
    }
    if (seg === '..') {
      throw new Error('path traversal');
    }
    if (seg.includes('\0')) {
      throw new Error('invalid path');
    }
    parts.push(seg);
  }
  if (parts.length === 0) {
    return '';
  }
  return path.join(...parts);
}

/**
 * @param {string} rootAbs absolute directory root for this mount
 * @param {string} relPath safe relative path (use assertSafeRelativePath first)
 * @returns {string} absolute file path
 */
export function joinUnderRoot(rootAbs, relPath) {
  const rootResolved = path.resolve(rootAbs);
  const joined =
    relPath === '' ? path.resolve(rootResolved) : path.resolve(rootResolved, relPath);
  const rel = path.relative(rootResolved, joined);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('path outside mount root');
  }
  return joined;
}

/**
 * Ensure resolved real path stays under root (symlink escape).
 * @param {string} rootAbs
 * @param {string} fileAbs
 * @returns {string} realpath of file
 */
export function assertRealPathInsideRoot(rootAbs, fileAbs) {
  const rootReal = fs.realpathSync.native(rootAbs);
  let fileReal;
  try {
    fileReal = fs.realpathSync.native(fileAbs);
  } catch {
    throw new Error('not found');
  }
  const rel = path.relative(rootReal, fileReal);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('path outside mount root (symlink)');
  }
  return fileReal;
}
