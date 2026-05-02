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

export function setAtDotPath(target: DotPathRecord, dotKey: string, value: unknown): void {
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

export function removeAtDotPath(target: DotPathRecord, dotKey: string): void {
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
