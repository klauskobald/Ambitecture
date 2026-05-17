export interface ClientSubscribeState {
  runtime: boolean;
  events: boolean;
}

export type ParsedControllerSubscribe = { runtime: boolean };
export type ParsedRendererSubscribe = { events: boolean };

export function parseSubscribe(
  role: 'controller' | 'renderer',
  subscribe: unknown,
): ParsedControllerSubscribe | ParsedRendererSubscribe | null {
  if (!subscribe || typeof subscribe !== 'object' || Array.isArray(subscribe)) {
    return null;
  }
  const s = subscribe as Record<string, unknown>;
  if (role === 'controller') {
    if (typeof s['runtime'] !== 'boolean') {
      return null;
    }
    return { runtime: s['runtime'] };
  }
  if (typeof s['events'] !== 'boolean') {
    return null;
  }
  return { events: s['events'] };
}

export function toClientSubscribeState(
  role: 'controller' | 'renderer',
  parsed: ParsedControllerSubscribe | ParsedRendererSubscribe,
): ClientSubscribeState {
  if (role === 'controller') {
    const p = parsed as ParsedControllerSubscribe;
    return { runtime: p.runtime, events: false };
  }
  const p = parsed as ParsedRendererSubscribe;
  return { runtime: false, events: p.events };
}
