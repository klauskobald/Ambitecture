import type { ActionExecuteItem } from '../../ProjectManager';

export function executeParamsFromItem(item: ActionExecuteItem): Record<string, unknown> | undefined {
  const r = item as Record<string, unknown>;
  const p = r['params'];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return undefined;
  return p as Record<string, unknown>;
}

export function shallowMergeActionParams(
  stored: Record<string, unknown> | undefined,
  triggerArgs: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return { ...(stored ?? {}), ...(triggerArgs ?? {}) };
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
