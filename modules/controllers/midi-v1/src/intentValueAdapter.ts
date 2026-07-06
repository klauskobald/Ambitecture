type IntentPropertyDescriptor = {
  dotKey?: unknown;
  type?: unknown;
  options?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringOptions(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item.length === 0) return null;
    out.push(item);
  }
  return out;
}

export function findIntentPropertyDescriptor(
  intentClass: string,
  dotKey: string,
  systemCapabilities: unknown,
): IntentPropertyDescriptor | null {
  if (!intentClass || !dotKey || !isRecord(systemCapabilities)) return null;
  const intentProperties = systemCapabilities['intentProperties'];
  if (!isRecord(intentProperties)) return null;
  const list = intentProperties[intentClass];
  if (!Array.isArray(list)) return null;
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    if (entry['dotKey'] === dotKey) {
      return entry as IntentPropertyDescriptor;
    }
  }
  return null;
}

function mapNormalizedToOption(normalized: number, options: string[]): string {
  const n = options.length;
  const clamped = Math.max(0, Math.min(1, normalized));
  const index = Math.min(n - 1, Math.floor(clamped * (n + 1)));
  return options[index]!;
}

export function adaptIntentPropertyValue(
  descriptor: IntentPropertyDescriptor,
  normalizedNumber: number,
): unknown {
  const dtype = typeof descriptor.type === 'string' ? descriptor.type : '';
  if (dtype === 'number') {
    return normalizedNumber;
  }
  if (dtype === 'string') {
    const options = stringOptions(descriptor.options);
    if (options !== null) {
      return mapNormalizedToOption(normalizedNumber, options);
    }
  }
  return normalizedNumber;
}

export function adaptIntentTargetValue(
  intentClass: string,
  dotKey: string,
  normalizedNumber: number,
  systemCapabilities: unknown,
): unknown {
  const descriptor = findIntentPropertyDescriptor(intentClass, dotKey, systemCapabilities);
  if (!descriptor) {
    return normalizedNumber;
  }
  return adaptIntentPropertyValue(descriptor, normalizedNumber);
}
