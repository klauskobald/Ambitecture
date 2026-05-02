export type RuntimeEntityType = string;

export interface RuntimeCommand {
  entityType: RuntimeEntityType;
  guid: string;
  patch?: Record<string, unknown>;
  remove?: string[];
  value?: Record<string, unknown>;
  source?: string;
  class?: string;
  target?: string;
  scheduled?: number;
}

export interface RuntimeUpdate extends RuntimeCommand {
  source: string;
}

export function isRuntimeCommand(payload: unknown): payload is RuntimeCommand {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const p = payload as Record<string, unknown>;
  const patch = p['patch'];
  const remove = p['remove'];
  const value = p['value'];
  const hasValidPatch = patch === undefined || (typeof patch === 'object' && patch !== null && !Array.isArray(patch));
  const hasValidRemove = remove === undefined || (Array.isArray(remove) && remove.every(item => typeof item === 'string'));
  const hasValidValue = value === undefined || (typeof value === 'object' && value !== null && !Array.isArray(value));
  return typeof p['entityType'] === 'string'
    && p['entityType'].length > 0
    && typeof p['guid'] === 'string'
    && p['guid'].length > 0
    && hasValidPatch
    && hasValidRemove
    && hasValidValue;
}
