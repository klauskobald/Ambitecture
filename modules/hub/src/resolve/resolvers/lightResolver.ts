import { ResolveColor, type BlendMode } from '../resolveColor';
import {
  type CapabilityResolver,
  type FixtureCtx,
  type ResolveIntent,
  type Caps,
  computeSpatialFactor,
  inFixtureZone,
} from '../CapabilityResolver';

/**
 * `light` resolver — spatial color blend (`light.color.xyY`), spatial-additive `light.strobe` /
 * `light.brightness`, top-layer `light.aux`. 1:1 port of the renderer `LayerIntentEngine` light
 * sampling, operating on the hub's effective intents. Stateless.
 */
export class LightResolver implements CapabilityResolver {
  readonly intentClass = 'light';

  resolve(ctx: FixtureCtx, intents: ResolveIntent[], caps: Caps): void {
    const scoped = intents.filter(i => inFixtureZone(i, ctx.zoneName));
    const color = this.resolveColor(ctx, scoped);
    caps['light.color.xyY'] = [color.x, color.y, color.Y];
    caps['light.strobe'] = this.spatialAdditive(ctx, scoped, 'strobe', true);
    caps['light.brightness'] = this.spatialAdditive(ctx, scoped, 'brightness', false);
    const aux = this.topLayerAux(scoped);
    if (Object.keys(aux).length > 0) {
      caps['light.aux'] = aux;
    }
  }

  private resolveColor(ctx: FixtureCtx, intents: ResolveIntent[]): ResolveColor {
    const byLayer = new Map<number, ResolveIntent[]>();
    for (const intent of intents) {
      const peers = byLayer.get(intent.layer) ?? [];
      peers.push(intent);
      byLayer.set(intent.layer, peers);
    }

    let mixed = ResolveColor.black();
    for (const layerNum of [...byLayer.keys()].sort((a, b) => a - b)) {
      const peers = byLayer.get(layerNum)!;
      peers.sort((a, b) => a.guid.localeCompare(b.guid));

      let peerR = 0;
      let peerG = 0;
      let peerB = 0;
      const layerAlphas: number[] = [];
      const layerIntents: ResolveIntent[] = [];

      for (const intent of peers) {
        const colorData = intent.params['color'] as { x?: unknown; y?: unknown; Y?: unknown } | undefined;
        if (!colorData) continue;
        if (
          typeof colorData.x !== 'number' ||
          typeof colorData.y !== 'number' ||
          typeof colorData.Y !== 'number'
        ) {
          continue;
        }
        const spatialFactor = computeSpatialFactor(ctx, intent.position, intent.radius, intent.radiusFunction);
        const effectiveAlpha = Math.max(0, Math.min(1, intent.alpha * spatialFactor));
        const layerColor = new ResolveColor(colorData.x, colorData.y, Math.max(0, Math.min(1, colorData.Y)));
        const lin = layerColor.toLinearRGB();
        peerR += lin.r * effectiveAlpha;
        peerG += lin.g * effectiveAlpha;
        peerB += lin.b * effectiveAlpha;
        layerAlphas.push(effectiveAlpha);
        layerIntents.push(intent);
      }

      if (layerAlphas.length === 0) continue;

      const layerMixed = ResolveColor.fromLinearRGB(Math.min(1, peerR), Math.min(1, peerG), Math.min(1, peerB));
      const interLayerBlend = resolveLayerBlendMode(layerIntents);
      const interLayerAlpha = aggregateInterLayerAlpha(layerAlphas, interLayerBlend);
      mixed = mixed.blend(layerMixed, interLayerBlend, interLayerAlpha);
    }
    return mixed;
  }

  // Accumulates from 0 (additive effects). omitIntentAlpha=true for strobe (per renderer).
  private spatialAdditive(ctx: FixtureCtx, intents: ResolveIntent[], paramKey: string, omitIntentAlpha: boolean): number {
    const layers = [...intents].sort((a, b) => a.layer - b.layer);
    let result = 0;
    for (const intent of layers) {
      const value = intent.params[paramKey];
      if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) continue;
      const f = computeSpatialFactor(ctx, intent.position, intent.radius, intent.radiusFunction);
      const alphaScale = omitIntentAlpha ? 1 : intent.alpha;
      result = Math.min(1, result + value * f * alphaScale);
    }
    return result;
  }

  private topLayerAux(intents: ResolveIntent[]): Record<string, number> {
    const layers = [...intents].sort((a, b) => b.layer - a.layer);
    const result: Record<string, number> = {};
    for (const intent of layers) {
      const aux = intent.params['aux'];
      if (aux === null || typeof aux !== 'object' || Array.isArray(aux)) continue;
      for (const [key, value] of Object.entries(aux as Record<string, unknown>)) {
        if (!(key in result) && typeof value === 'number' && Number.isFinite(value)) {
          result[key] = value;
        }
      }
    }
    return result;
  }
}

function resolveLayerBlendMode(intents: ResolveIntent[]): BlendMode {
  if (intents.length === 0) return 'ADD';
  const sorted = [...intents].sort((a, b) => a.guid.localeCompare(b.guid));
  const firstBlend = sorted[0]!.blend;
  const allSame = intents.every(i => i.blend === firstBlend);
  return allSame ? firstBlend : sorted[0]!.blend;
}

function aggregateInterLayerAlpha(alphas: number[], blend: BlendMode): number {
  if (alphas.length === 0) return 0;
  if (blend === 'ADD') return 1;
  return Math.max(...alphas);
}
