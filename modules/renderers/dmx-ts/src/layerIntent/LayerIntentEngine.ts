import { Color, BlendMode } from '../color';
import { Vector3 } from '../Vector3';
import { ConfiguredFixture, ConfiguredZone } from '../handlers/ConfigHandler';
import { RendererEvent } from '../fixtures/IFixtureClass';
import { FnCurve } from '../FnCurve';

export interface IntentRecord {
    guid?: string;
    layer: number;
    zoneName?: string;
    intentType: string;
    position?: [number, number, number];
    radius?: number;
    radiusFunction?: string;
    blend?: BlendMode;
    alpha?: number;
    payload: Record<string, unknown>;
}

export interface FixtureSampleContext {
    fixture: ConfiguredFixture;
    fixtureWorldPos: [number, number, number];
    zoneName: string;
}

export interface CapabilityResolver<TValue> {
    sample(context: FixtureSampleContext, intents: ReadonlyMap<string, IntentRecord>, withSpatialFactor?: boolean): TValue | undefined;
}

function isPositionInZone(
    pos: [number, number, number],
    bbox: [number, number, number, number, number, number]
): boolean {
    return pos[0] >= bbox[0] && pos[0] <= bbox[3]
        && pos[1] >= bbox[1] && pos[1] <= bbox[4]
        && pos[2] >= bbox[2] && pos[2] <= bbox[5];
}

function toLayer(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return 0;
}

function toAlpha(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.min(1, value));
    }
    return 1;
}

function toBlend(value: unknown): BlendMode {
    switch (value) {
        case 'ALPHA':
        case 'MULTIPLY':
            return value;
        case 'ADD':
        default:
            return 'ADD';
    }
}

function toIntentRecord(event: RendererEvent): IntentRecord {
    const params = (event.params && typeof event.params === 'object' ? event.params : {}) as Record<string, unknown>;
    const record: IntentRecord = {
        layer: toLayer(event.layer),
        intentType: event.class,
        blend: toBlend(params['blend']),
        alpha: toAlpha(params['alpha']),
        payload: params,
    };
    if (event.guid !== undefined) {
        record.guid = event.guid;
    }
    if (event.position) {
        record.position = event.position;
    }
    if (typeof event.radius === 'number' && Number.isFinite(event.radius)) {
        record.radius = event.radius;
    }
    if (typeof event.radiusFunction === 'string' && event.radiusFunction.trim() !== '') {
        record.radiusFunction = event.radiusFunction;
    }
    return record;
}

export class LayerIntentEngine {
    private readonly intentsByLayer = new Map<string, IntentRecord>();
    private readonly resolvers = new Map<string, CapabilityResolver<unknown>>();

    constructor() {
        this.registerResolver<Color>('light.color.xyY', {
            sample: (context, intents, withSpatialFactor = true) => this.sampleLightColor(context, intents, withSpatialFactor),
        });
        this.registerResolver<number>('light.strobe', {
            sample: (context, intents) => this.sampleSpatialAdditive(context, intents, 'light', 'strobe', true),
        });
        this.registerResolver<number>('light.brightness', {
            sample: (context, intents) => this.sampleSpatialAdditive(context, intents, 'light', 'brightness'),
        });
        this.registerResolver<Record<string, number>>('light.aux', {
            sample: (_context, intents) => this.sampleTopLayerAux(intents, 'light'),
        });
        this.registerResolver<number>('master.brightness', {
            sample: (_context, intents) => this.sampleTopLayerNumber(intents, 'master', 'brightness'),
        });
        this.registerResolver<boolean>('master.blackout', {
            sample: (_context, intents) => this.sampleTopLayerBoolean(intents, 'master', 'blackout'),
        });
    }

    registerResolver<TValue>(capabilityKey: string, resolver: CapabilityResolver<TValue>): void {
        this.resolvers.set(capabilityKey, resolver as CapabilityResolver<unknown>);
    }

    applyEvent(event: RendererEvent, zones: ConfiguredZone[]): boolean {
        if (!event.guid) return false;
        if (event.removed === true) {
            return this.intentsByLayer.delete(event.guid);
        }
        if (zones.length === 0) return false;

        const eventPos = event.position;
        const intent = toIntentRecord(event);
        if (eventPos) {
            const matchedZone = zones.find((zone) => isPositionInZone(eventPos, zone.boundingBox));
            if (!matchedZone) return this.intentsByLayer.delete(event.guid);
            intent.zoneName = matchedZone.name;
        }
        this.intentsByLayer.set(event.guid, intent);
        return true;
    }

    getActiveIntents(): ReadonlyMap<string, IntentRecord> {
        return this.intentsByLayer;
    }

    sample<TValue>(context: FixtureSampleContext, capabilityKey: string, withSpatialFactor?: boolean): TValue | undefined {
        const resolver = this.resolvers.get(capabilityKey);
        if (!resolver) return undefined;
        const scopedIntentsByLayer = new Map(
            [...this.intentsByLayer.entries()]
                .filter(([, intent]) => intent.zoneName === undefined || intent.zoneName === context.zoneName)
        );
        return resolver.sample(context, scopedIntentsByLayer, withSpatialFactor) as TValue | undefined;
    }

    private sampleLightColor(context: FixtureSampleContext, intentsByLayer: ReadonlyMap<string, IntentRecord>, withSpatialFactor: boolean): Color {
        const lightEntries = [...intentsByLayer.entries()]
            .filter(([, intent]) => intent.intentType === 'light');

        const byLayer = new Map<number, { guid: string; intent: IntentRecord }[]>();
        for (const [guid, intent] of lightEntries) {
            const layer = intent.layer;
            if (!byLayer.has(layer)) {
                byLayer.set(layer, []);
            }
            byLayer.get(layer)!.push({ guid, intent });
        }

        let mixed = Color.black();
        for (const layerNum of [...byLayer.keys()].sort((a, b) => a - b)) {
            const peers = byLayer.get(layerNum)!;
            peers.sort((a, b) => a.guid.localeCompare(b.guid));

            let peerR = 0;
            let peerG = 0;
            let peerB = 0;
            const layerAlphas: number[] = [];
            const layerIntents: IntentRecord[] = [];

            for (const { intent } of peers) {
                const colorData = intent.payload['color'] as { x?: unknown; y?: unknown; Y?: unknown } | undefined;
                if (!colorData) continue;
                if (
                    typeof colorData.x !== 'number' ||
                    typeof colorData.y !== 'number' ||
                    typeof colorData.Y !== 'number'
                ) {
                    continue;
                }

                const spatialFactor = withSpatialFactor ? this.computeSpatialFactor(
                    context.fixture,
                    context.fixtureWorldPos,
                    intent.position,
                    context.fixture.range,
                    intent.radius,
                    intent.radiusFunction
                ) : 1;
                // Spatial factor folds into the blend alpha (not Y), so that ALPHA / MULTIPLY
                // also fade out where the intent does not reach. Outside the radius
                // effectiveAlpha = 0 → upper layer is fully transparent and the lower layer
                // passes through. For ADD this is algebraically equivalent to the previous
                // (Y * spatialFactor) approach.
                const effectiveAlpha = Math.max(0, Math.min(1, (intent.alpha ?? 1) * spatialFactor));
                const layerColor = new Color(colorData.x, colorData.y, Math.max(0, Math.min(1, colorData.Y)));
                const lin = layerColor.toLinearRGB();
                peerR += lin.r * effectiveAlpha;
                peerG += lin.g * effectiveAlpha;
                peerB += lin.b * effectiveAlpha;
                layerAlphas.push(effectiveAlpha);
                layerIntents.push(intent);
            }

            if (layerAlphas.length === 0) continue;

            const layerMixed = Color.fromLinearRGB(
                Math.min(1, peerR),
                Math.min(1, peerG),
                Math.min(1, peerB),
            );

            const interLayerBlend = this.resolveLayerBlendMode(layerIntents);
            const interLayerAlpha = this.aggregateInterLayerAlpha(layerAlphas, interLayerBlend);
            mixed = mixed.blend(layerMixed, interLayerBlend, interLayerAlpha);
        }
        return mixed;
    }

    private resolveLayerBlendMode(intents: IntentRecord[]): BlendMode {
        if (intents.length === 0) return 'ADD';
        const sorted = [...intents].sort((a, b) => (a.guid ?? '').localeCompare(b.guid ?? ''));
        const firstBlend = sorted[0]!.blend ?? 'ADD';
        const allSame = intents.every(i => (i.blend ?? 'ADD') === firstBlend);
        return allSame ? firstBlend : (sorted[0]!.blend ?? 'ADD');
    }

    private aggregateInterLayerAlpha(alphas: number[], blend: BlendMode): number {
        if (alphas.length === 0) return 0;
        if (blend === 'ADD') return 1;
        return Math.max(...alphas);
    }

    // Accumulates from 0. Zero-state = 0. Use for additive effects (strobe).
    private sampleSpatialAdditive(
        context: FixtureSampleContext,
        intentsByLayer: ReadonlyMap<string, IntentRecord>,
        intentType: string,
        paramKey: string,
        omitIntentAlpha = false,
    ): number {
        const layers = this.lightLayersSorted(intentsByLayer, intentType);
        let result = 0;
        for (const intent of layers) {
            const value = intent.payload[paramKey];
            if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) continue;
            const f = this.computeSpatialFactor(context.fixture, context.fixtureWorldPos,
                intent.position, context.fixture.range, intent.radius, intent.radiusFunction);
            const alphaScale = omitIntentAlpha ? 1 : (intent.alpha ?? 1);
            result = Math.min(1, result + value * f * alphaScale);
        }
        return result;
    }

    // Reduces from 1. Zero-state = 1. Use for modulative effects (brightness).
    // Outside an intent's radius spatialFactor → 0, so reduction → 0 and result stays 1.
    private sampleSpatialSubtractive(
        context: FixtureSampleContext,
        intentsByLayer: ReadonlyMap<string, IntentRecord>,
        intentType: string,
        paramKey: string
    ): number {
        const layers = this.lightLayersSorted(intentsByLayer, intentType);
        let reduction = 0;
        for (const intent of layers) {
            const value = intent.payload[paramKey];
            if (typeof value !== 'number' || !Number.isFinite(value)) continue;
            const f = this.computeSpatialFactor(context.fixture, context.fixtureWorldPos,
                intent.position, context.fixture.range, intent.radius, intent.radiusFunction);
            reduction = Math.min(1, reduction + (1 - value) * f * (intent.alpha ?? 1));
        }
        return Math.max(0, 1 - reduction);
    }

    private lightLayersSorted(
        intentsByLayer: ReadonlyMap<string, IntentRecord>,
        intentType: string
    ): IntentRecord[] {
        return [...intentsByLayer.values()]
            .filter(intent => intent.intentType === intentType)
            .sort((a, b) => a.layer - b.layer);
    }

    private sampleTopLayerNumber(
        intentsByLayer: ReadonlyMap<string, IntentRecord>,
        intentType: string,
        fieldName: string
    ): number | undefined {
        const layers = [...intentsByLayer.entries()]
            .filter(([, intent]) => intent.intentType === intentType)
            .sort(([, a], [, b]) => b.layer - a.layer);
        for (const [, intent] of layers) {
            const value = intent.payload[fieldName];
            if (typeof value === 'number' && Number.isFinite(value)) return value;
        }
        return undefined;
    }

    private sampleTopLayerBoolean(
        intentsByLayer: ReadonlyMap<string, IntentRecord>,
        intentType: string,
        fieldName: string
    ): boolean | undefined {
        const layers = [...intentsByLayer.entries()]
            .filter(([, intent]) => intent.intentType === intentType)
            .sort(([, a], [, b]) => b.layer - a.layer);
        for (const [, intent] of layers) {
            const value = intent.payload[fieldName];
            if (typeof value === 'boolean') return value;
        }
        return undefined;
    }

    private sampleTopLayerAux(
        intentsByLayer: ReadonlyMap<string, IntentRecord>,
        intentType: string
    ): Record<string, number> {
        const layers = [...intentsByLayer.entries()]
            .filter(([, intent]) => intent.intentType === intentType)
            .sort(([, a], [, b]) => b.layer - a.layer);

        const result: Record<string, number> = {};
        for (const [, intent] of layers) {
            const aux = intent.payload['aux'];
            if (aux === null || typeof aux !== 'object' || Array.isArray(aux)) continue;
            for (const [key, value] of Object.entries(aux as Record<string, unknown>)) {
                if (!(key in result) && typeof value === 'number' && Number.isFinite(value)) {
                    result[key] = value;
                }
            }
        }
        return result;
    }

    private computeSpatialFactor(
        fixture: ConfiguredFixture,
        fixtureWorldPos: [number, number, number],
        intentPos: [number, number, number] | undefined,
        range: number,
        intentRadius: number | undefined,
        intentRadiusFunction: string | undefined
    ): number {
        if (!intentPos || range <= 0) return 1;
        const distance = Vector3.fromTo(fixtureWorldPos, intentPos).magnitude();
        const fixtureNormalized = Math.max(0, 1 - distance / range);
        const fixtureCurveName = fixture.params['rangeFunction'] ?? fixture.params['rangeFn'];
        const fixtureFactor = FnCurve.evaluate(fixtureCurveName, fixtureNormalized);
        if (intentRadius === undefined || intentRadius <= 0) {
            return fixtureFactor;
        }
        const intentNormalized = Math.max(0, 1 - distance / intentRadius);
        const intentFactor = FnCurve.evaluate(intentRadiusFunction, intentNormalized);
        return fixtureFactor * intentFactor;
    }
}

