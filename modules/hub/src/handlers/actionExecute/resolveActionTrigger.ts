import type { ActionExecuteItem } from '../../ProjectManager';

export function executeParamsFromItem(item: ActionExecuteItem): Record<string, unknown> | undefined {
  const r = item as Record<string, unknown>;
  return plainObjectRecord(r['params']);
}

export function shallowMergeActionParams(
  stored: Record<string, unknown> | undefined,
  triggerArgs: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return { ...(stored ?? {}), ...(triggerArgs ?? {}) };
}

function plainObjectRecord(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  return v as Record<string, unknown>;
}

export function isActiveTriggerValue(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null) return false;
  if (value === undefined) return false;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'on' || s === '1' || s === 'true' || s === 'yes') return true;
    if (s === 'off' || s === '0' || s === 'false' || s === 'no' || s === '') return false;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value !== 0;
  }
  return false;
}

export type ResolveBranchesResult =
  | { ok: true; resolved: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Intent / animation: merged bag must contain either `args` (single branch) or `argsOn`/`argsOff` (dual branch).
 * Dual branch requires trigger-supplied `value` on the merged bag.
 */
export function resolveIntentOrAnimationBranches(merged: Record<string, unknown>): ResolveBranchesResult {
  const argsOn = plainObjectRecord(merged['argsOn']);
  const argsOff = plainObjectRecord(merged['argsOff']);
  const hasDual = argsOn !== undefined || argsOff !== undefined;

  if (hasDual) {
    if (!Object.prototype.hasOwnProperty.call(merged, 'value')) {
      return { ok: false, reason: 'dual-branch action requires args.value on trigger' };
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

  return { ok: false, reason: 'execute.params must include args or argsOn/argsOff' };
}
