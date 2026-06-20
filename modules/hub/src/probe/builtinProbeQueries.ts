import { ProbeContext, registerProbeQuery } from './ProbeQueryRegistry';

interface ConnectedModule {
  name: string;
  entity: string;
}

function connectedRenderers(ctx: ProbeContext): ConnectedModule[] {
  return ctx.registry
    .getByRole('renderer')
    .map(ws => ctx.registry.get(ws)?.guid ?? '')
    .filter(guid => guid !== '')
    .map(guid => ({ name: guid, entity: 'renderer' }));
}

export function registerBuiltinProbeQueries(): void {
  registerProbeQuery('connectedRenderers', connectedRenderers);
}
