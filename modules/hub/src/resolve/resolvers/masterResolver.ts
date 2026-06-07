import {
  type CapabilityResolver,
  type FixtureCtx,
  type ResolveIntent,
  type Caps,
  inFixtureZone,
} from '../CapabilityResolver';

/**
 * `master` resolver — top-layer `master.brightness` / `master.blackout`. Master intents are global
 * (position-less), so they reach every fixture. Stateless. 1:1 port of the renderer top-layer sampling.
 */
export class MasterResolver implements CapabilityResolver {
  readonly intentClass = 'master';

  resolve(ctx: FixtureCtx, intents: ResolveIntent[], caps: Caps): void {
    const scoped = intents.filter(i => inFixtureZone(i, ctx.zoneName));
    const brightness = topLayerNumber(scoped, 'brightness');
    if (brightness !== undefined) caps['master.brightness'] = brightness;
    const blackout = topLayerBoolean(scoped, 'blackout');
    if (blackout !== undefined) caps['master.blackout'] = blackout;
  }
}

function topLayerNumber(intents: ResolveIntent[], field: string): number | undefined {
  const layers = [...intents].sort((a, b) => b.layer - a.layer);
  for (const intent of layers) {
    const value = intent.params[field];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function topLayerBoolean(intents: ResolveIntent[], field: string): boolean | undefined {
  const layers = [...intents].sort((a, b) => b.layer - a.layer);
  for (const intent of layers) {
    const value = intent.params[field];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}
