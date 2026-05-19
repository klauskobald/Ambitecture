/**
 * Resolve intent GUIDs an animation drives at runtime.
 * Canonical: `targetIntents[]`; legacy singular `targetIntent` / `intent`.
 */
export function resolveAnimationTargetIntents(
  record: Record<string, unknown> | undefined,
): string[] {
  if (!record) return [];

  if (Array.isArray(record['targetIntents'])) {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of record['targetIntents']) {
      if (typeof item !== 'string') continue;
      const g = item.trim();
      if (!g || seen.has(g)) continue;
      seen.add(g);
      out.push(g);
    }
    return out;
  }

  const legacy =
    (typeof record['targetIntent'] === 'string' && record['targetIntent'].length > 0
      ? record['targetIntent']
      : undefined) ??
    (typeof record['intent'] === 'string' && record['intent'].length > 0
      ? record['intent']
      : undefined);
  return legacy ? [legacy] : [];
}
