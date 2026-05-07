export interface BindingSubscribeCommand {
  key: string;
}

export interface BindingSetCommand {
  key: string;
  value: unknown;
}

export function isBindingSubscribeCommand(p: unknown): p is BindingSubscribeCommand {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  return typeof (p as Record<string, unknown>)['key'] === 'string';
}

export function isBindingSetCommand(p: unknown): p is BindingSetCommand {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  const r = p as Record<string, unknown>;
  return typeof r['key'] === 'string' && 'value' in r;
}

export function buildBindingValueMessage(key: string, value: unknown): string {
  return JSON.stringify({ message: { type: 'binding:value', payload: { key, value } } });
}
