export type DotPathRecord = Record<string, unknown>;

export function cloneRecord(value: DotPathRecord): DotPathRecord {

  return JSON.parse(JSON.stringify(value)) as DotPathRecord;
}

export function readAtDotPath(target: DotPathRecord, dotKey: string): unknown {
  return dotKey.split('.').reduce((current: unknown, segment: string) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as DotPathRecord)[segment];
  }, target as unknown);
}

function parseArrayIndex(segment: string): number | null {
  if (!/^\d+$/.test(segment)) return null;
  const index = Number(segment);
  if (!Number.isInteger(index) || index < 0) return null;
  return index;
}

function isContainer(value: unknown): value is DotPathRecord | unknown[] {
  return !!value && typeof value === 'object';
}
/* object version of setAtDotPath and removeAtDotPath - cannot be used for arrays
export function setAtDotPath_Obj(target: DotPathRecord, dotKey: string, value: unknown): void {
  const segments = dotKey.split('.');
  let cursor = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    const existing = cursor[segment];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as DotPathRecord;
  }
  cursor[segments[segments.length - 1]!] = value;
}

export function removeAtDotPath_Obj(target: DotPathRecord, dotKey: string): void {
  const segments = dotKey.split('.');
  let cursor = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    const existing = cursor[segment];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return;
    cursor = existing as DotPathRecord;
  }
  delete cursor[segments[segments.length - 1]!];
}
  */

export function setAtDotPath(target: DotPathRecord, dotKey: string, value: unknown): void {
  const segments = dotKey.split('.');
  let cursor: DotPathRecord | unknown[] = target;

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    const nextSegment = segments[i + 1]!;

    if (Array.isArray(cursor)) {
      const index = parseArrayIndex(segment);
      if (index === null) return;

      const existing = cursor[index];
      if (!isContainer(existing)) {
        cursor[index] = parseArrayIndex(nextSegment) !== null ? [] : {};
      }
      cursor = cursor[index] as DotPathRecord | unknown[];
      continue;
    }

    const existing = cursor[segment];
    if (!isContainer(existing)) {
      cursor[segment] = parseArrayIndex(nextSegment) !== null ? [] : {};
    }
    cursor = cursor[segment] as DotPathRecord | unknown[];
  }

  const last = segments[segments.length - 1]!;
  if (Array.isArray(cursor)) {
    const index = parseArrayIndex(last);
    if (index === null) return;
    cursor[index] = value;
    return;
  }
  cursor[last] = value;
}

export function removeAtDotPath(target: DotPathRecord, dotKey: string): void {
  const segments = dotKey.split('.');
  let cursor: DotPathRecord | unknown[] = target;

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;

    if (Array.isArray(cursor)) {
      const index = parseArrayIndex(segment);
      if (index === null) return;
      const existing = cursor[index];
      if (!isContainer(existing)) return;
      cursor = existing as DotPathRecord | unknown[];
      continue;
    }

    const existing = cursor[segment];
    if (!isContainer(existing)) return;
    cursor = existing as DotPathRecord | unknown[];
  }

  const last = segments[segments.length - 1]!;
  if (Array.isArray(cursor)) {
    const index = parseArrayIndex(last);
    if (index === null) return;
    delete cursor[index];
    return;
  }
  delete cursor[last];
}

export function applyDotPathPatch(
  target: DotPathRecord,
  patch: DotPathRecord,
  remove: string[] = [],
): DotPathRecord {
  const next = cloneRecord(target);
  for (const [key, value] of Object.entries(patch)) {
    setAtDotPath(next, key, value);
  }
  for (const key of remove) {
    removeAtDotPath(next, key);
  }
  return next;
}

/** Root keys omitted from keyframe delta patches (identity / routing noise). */
const DIFF_PATCH_SKIP_ROOT_KEYS = new Set(['guid', 'entityType']);

function deepEqualLeaves(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return a === b;
  if (a === undefined || b === undefined) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const aa = a as unknown[];
    const bb = b as unknown[];
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i++) {
      if (!deepEqualLeaves(aa[i], bb[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  const bSet = new Set(bKeys);
  for (const k of aKeys) {
    if (!bSet.has(k)) return false;
    if (!deepEqualLeaves(ao[k], bo[k])) return false;
  }
  return true;
}

function walkNextLeavesForDiff(
  nextVal: unknown,
  base: DotPathRecord,
  prefix: string,
  patch: DotPathRecord,
): void {
  if (nextVal === null || typeof nextVal !== 'object' || Array.isArray(nextVal)) {
    if (prefix.length === 0) return;
    const baseVal = readAtDotPath(base, prefix);
    if (!deepEqualLeaves(baseVal, nextVal)) {
      patch[prefix] = nextVal as unknown;
    }
    return;
  }
  const nextObj = nextVal as Record<string, unknown>;
  const keys = Object.keys(nextObj);
  if (keys.length === 0) {
    if (prefix.length === 0) return;
    const baseVal = readAtDotPath(base, prefix);
    if (!deepEqualLeaves(baseVal, nextObj)) {
      patch[prefix] = nextObj;
    }
    return;
  }
  for (const k of keys) {
    if (prefix === '' && DIFF_PATCH_SKIP_ROOT_KEYS.has(k)) continue;
    const childPrefix = prefix.length === 0 ? k : `${prefix}.${k}`;
    walkNextLeavesForDiff(nextObj[k], base, childPrefix, patch);
  }
}

/**
 * Flat dot-path patch of leaf values in `next` that differ from `base` (same shape as runtime / keyframe `args`).
 */
export function diffRecordsToPatch(base: DotPathRecord, next: DotPathRecord): DotPathRecord {
  const patch: DotPathRecord = {};
  walkNextLeavesForDiff(next, base, '', patch);
  return patch;
}
