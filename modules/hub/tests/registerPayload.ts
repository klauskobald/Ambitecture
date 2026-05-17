export type ControllerSubscribe = { runtime: boolean };
export type RendererSubscribe = { events: boolean };

export function buildRegisterPayload(
  role: 'controller',
  guid: string,
  subscribe: ControllerSubscribe,
  extra?: Record<string, unknown>,
): Record<string, unknown>;
export function buildRegisterPayload(
  role: 'renderer',
  guid: string,
  subscribe: RendererSubscribe,
  extra?: Record<string, unknown>,
): Record<string, unknown>;
export function buildRegisterPayload(
  role: 'controller' | 'renderer',
  guid: string,
  subscribe: ControllerSubscribe | RendererSubscribe,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    role,
    guid,
    ...extra,
    subscribe,
  };
}
