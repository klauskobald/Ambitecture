import { Logger } from '../Logger';

export type NormalizedInputType = {
  class: string;
  name: string;
  hint: string;
  params: Record<string, string>;
};

export type NormalizedDisplayType = {
  class: string;
  name: string;
};

function normalizeInputTypes(capabilities: unknown): NormalizedInputType[] {
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) return [];
  const raw = (capabilities as Record<string, unknown>)['inputTypes'];
  if (!Array.isArray(raw)) return [];
  const out: NormalizedInputType[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    const cls = typeof r['class'] === 'string' && r['class'].length > 0 ? r['class'] : '';
    if (!cls) continue;
    const name = typeof r['name'] === 'string' && r['name'].length > 0 ? r['name'] : cls;
    const hint = typeof r['hint'] === 'string' ? r['hint'] : '';
    const params: Record<string, string> = {};
    const pr = r['params'];
    if (pr && typeof pr === 'object' && !Array.isArray(pr)) {
      for (const [k, v] of Object.entries(pr as Record<string, unknown>)) {
        if (typeof v === 'string' && v.length > 0) params[k] = v;
      }
    }
    out.push({ class: cls, name, hint, params });
  }
  return out;
}

function normalizeDisplayTypes(capabilities: unknown): NormalizedDisplayType[] {
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) return [];
  const raw = (capabilities as Record<string, unknown>)['displayTypes'];
  if (!Array.isArray(raw)) return [];
  const out: NormalizedDisplayType[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    const cls = typeof r['class'] === 'string' && r['class'].length > 0 ? r['class'] : '';
    if (!cls) continue;
    const name = typeof r['name'] === 'string' && r['name'].length > 0 ? r['name'] : cls;
    out.push({ class: cls, name });
  }
  return out;
}

export function hasCapabilityInputTypes(capabilities: unknown): boolean {
  return normalizeInputTypes(capabilities).length > 0;
}

export function hasCapabilityDisplayTypes(capabilities: unknown): boolean {
  return normalizeDisplayTypes(capabilities).length > 0;
}

export function isKnownInputType(capabilities: unknown, type: string): boolean {
  return normalizeInputTypes(capabilities).some(t => t.class === type);
}

export function isKnownDisplayType(capabilities: unknown, display: string): boolean {
  return normalizeDisplayTypes(capabilities).some(t => t.class === display);
}

/**
 * Default perform input/display classes for scene quick-assign and hub fallbacks.
 * Prefers `class: button` when present, else first list entry.
 */
export function resolveDefaultPerformTypes(capabilities: unknown): { type: string; displayType: string } | null {
  const inputTypes = normalizeInputTypes(capabilities);
  const displayTypes = normalizeDisplayTypes(capabilities);
  if (inputTypes.length === 0 || displayTypes.length === 0) return null;
  const type = inputTypes.find(t => t.class === 'button')?.class ?? inputTypes[0]?.class;
  const displayType = displayTypes.find(t => t.class === 'button')?.class ?? displayTypes[0]?.class;
  if (!type || !displayType) return null;
  return { type, displayType };
}

function coerceJsonStringParam(value: unknown, paramKey: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    Logger.warn(`[action] param "${paramKey}" must be a plain JSON object for kind jsonString`);
    return undefined;
  }
  return value as Record<string, unknown>;
}

function applyParamKind(kind: string, value: unknown, paramKey: string): Record<string, unknown> | undefined {
  switch (kind) {
    case 'jsonString':
      return coerceJsonStringParam(value, paramKey);
    default:
      Logger.warn(`[action] unknown input param kind "${kind}" for key "${paramKey}" — extend inputAssignment/composeInputParams.ts`);
      return undefined;
  }
}

export type ComposeInputParamsResult =
  | { ok: true; params: Record<string, unknown> | undefined }
  | { ok: false; reason: string };

function legacyComposeWhenInputTypesMissing(inputConfig: Record<string, unknown>): ComposeInputParamsResult {
  Logger.warn('[action] systemCapabilities.inputTypes empty — using legacy param mapping (args / argsOn / argsOff only)');
  const out: Record<string, unknown> = {};
  for (const key of ['args', 'argsOn', 'argsOff'] as const) {
    if (!(key in inputConfig)) continue;
    const raw = inputConfig[key];
    if (raw === undefined) continue;
    const coerced = coerceJsonStringParam(raw, key);
    if (coerced === undefined && raw !== null) {
      return { ok: false, reason: `invalid value for param "${key}"` };
    }
    if (coerced !== undefined) out[key] = coerced;
  }
  return { ok: true, params: Object.keys(out).length > 0 ? out : undefined };
}

export function composeInputParamsFromCapabilities(
  capabilities: unknown,
  inputTypeClass: string,
  inputConfig: Record<string, unknown>,
): ComposeInputParamsResult {
  const defs = normalizeInputTypes(capabilities);
  if (defs.length === 0) {
    return legacyComposeWhenInputTypesMissing(inputConfig);
  }
  const def = defs.find(t => t.class === inputTypeClass);
  if (!def) {
    return { ok: false, reason: `unknown input type "${inputTypeClass}"` };
  }
  const out: Record<string, unknown> = {};
  for (const [paramKey, kind] of Object.entries(def.params)) {
    if (!(paramKey in inputConfig)) continue;
    const raw = inputConfig[paramKey];
    if (raw === undefined) continue;
    const coerced = applyParamKind(kind, raw, paramKey);
    if (coerced === undefined && raw !== undefined && raw !== null) {
      return { ok: false, reason: `invalid value for param "${paramKey}" (kind ${kind})` };
    }
    if (coerced !== undefined) {
      out[paramKey] = coerced;
    }
  }
  return { ok: true, params: Object.keys(out).length > 0 ? out : undefined };
}
