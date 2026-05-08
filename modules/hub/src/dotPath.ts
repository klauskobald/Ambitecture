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
