import { isActiveTriggerValue } from './merge';

function plainObjectRecord(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  return v as Record<string, unknown>;
}

export type ResolveIntentBranchesResult =
  | { ok: true; resolved: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Intent `execute.params` + trigger `args` merged bag: `argsOn` / `argsOff` + `value`, or single `args` (+ optional `value` → `params.value` on patch).
 */
export function resolveIntentMergedToPatch(merged: Record<string, unknown>): ResolveIntentBranchesResult {
  const argsOn = plainObjectRecord(merged['argsOn']);
  const argsOff = plainObjectRecord(merged['argsOff']);
  const hasDual = argsOn !== undefined || argsOff !== undefined;

  if (hasDual) {
    if (!Object.prototype.hasOwnProperty.call(merged, 'value')) {
      return { ok: false, reason: 'dual-branch intent requires args.value on trigger' };
    }
    const active = isActiveTriggerValue(merged['value']);
    const onBranch = argsOn ?? {};
    const offBranch = argsOff ?? {};
    const resolved = active ? { ...onBranch } : { ...offBranch };
    return { ok: true, resolved };
  }

  const argsOnly = plainObjectRecord(merged['args']);
  if (argsOnly !== undefined) {
    const resolved: Record<string, unknown> = { ...argsOnly };
    if (Object.prototype.hasOwnProperty.call(merged, 'value')) {
      resolved['params.value'] = merged['value'];
    }
    return { ok: true, resolved };
  }

  return { ok: false, reason: 'intent execute.params must include args or argsOn/argsOff' };
}
