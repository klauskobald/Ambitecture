import { ProbeContext, registerProbeQuery } from './ProbeQueryRegistry';

interface ConnectedRenderer {
  type: string;
  guid: string;
}

function connectedRenderers(ctx: ProbeContext): ConnectedRenderer[] {
  return ctx.registry
    .getByRole('renderer')
    .map(ws => ctx.registry.get(ws))
    .filter((info): info is NonNullable<typeof info> => !!info && info.guid !== '')
    .map(info => ({
      type: typeof info.meta['type'] === 'string' ? (info.meta['type'] as string) : 'unknown',
      guid: info.guid,
    }));
}

export function registerBuiltinProbeQueries(): void {
  registerProbeQuery('connectedRenderers', connectedRenderers);
}
