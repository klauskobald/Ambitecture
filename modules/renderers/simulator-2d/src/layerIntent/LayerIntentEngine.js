class LayerIntentEngine {
    constructor() {
        this._intentsByLayer = new Map();
        this._resolvers = new Map();

        this.registerResolver('light.color.xyY', (context, intentsByLayer) => {
            const layers = [...intentsByLayer.entries()]
                .filter(([, intent]) => intent.intentType === 'light')
                .sort(([a], [b]) => a - b);

            let mixed = Color.black();
            for (const [, intent] of layers) {
                const colorData = intent.payload?.color;
                if (!colorData) continue;
                if (typeof colorData.x !== 'number' || typeof colorData.y !== 'number' || typeof colorData.Y !== 'number') {
                    continue;
                }

                const spatialFactor = this._computeSpatialFactor(
                    context.fixture,
                    context.fixtureWorldPos,
                    intent.position,
                    context.fixture.range
                );
                const layerColor = new Color(colorData.x, colorData.y, Math.max(0, Math.min(1, colorData.Y * spatialFactor)));
                mixed = mixed.blend(layerColor, intent.blend || 'ADD', intent.alpha ?? 1);
            }
            return mixed;
        });

        this.registerResolver('light.strobe', (context, intentsByLayer) =>
            this._sampleSpatialStrobe(context, intentsByLayer)
        );
        this.registerResolver('light.aux', (_context, intentsByLayer) =>
            this._sampleTopLayerAux(intentsByLayer, 'light')
        );
        this.registerResolver('master.brightness', (_context, intentsByLayer) =>
            this._sampleTopLayerNumber(intentsByLayer, 'master', 'brightness')
        );
        this.registerResolver('master.blackout', (_context, intentsByLayer) =>
            this._sampleTopLayerBoolean(intentsByLayer, 'master', 'blackout')
        );
    }

    registerResolver(capabilityKey, resolverFn) {
        this._resolvers.set(capabilityKey, resolverFn);
    }

    applyEvent(event, zones) {
        if (!Array.isArray(zones) || zones.length === 0) return false;
        const eventLayer = this._toLayer(event?.params?.layer);
        const eventPos = event.position;
        const matchedZone = eventPos
            ? zones.find(zone => this._isPositionInZone(eventPos, zone.bbox))
            : null;
        if (eventPos && !matchedZone) {
            const removed = this._intentsByLayer.delete(eventLayer);
            return removed;
        }

        const intent = this._toIntentRecord(event);
        if (matchedZone) {
            intent.zoneName = matchedZone.name;
        }
        this._intentsByLayer.set(intent.layer, intent);
        return true;
    }

    getActiveIntentsByLayer() {
        return this._intentsByLayer;
    }

    sample(context, capabilityKey) {
        const resolver = this._resolvers.get(capabilityKey);
        if (!resolver) return undefined;
        const scopedIntentsByLayer = new Map(
            [...this._intentsByLayer.entries()]
                .filter(([, intent]) => intent.zoneName === undefined || intent.zoneName === context.zoneName)
        );
        return resolver(context, scopedIntentsByLayer);
    }

    _toIntentRecord(event) {
        const params = event.params && typeof event.params === 'object' ? event.params : {};
        return {
            layer: this._toLayer(params.layer),
            name: typeof event.name === 'string' ? event.name : '',
            intentType: event.class,
            position: event.position,
            blend: this._toBlend(params.blend),
            alpha: this._toAlpha(params.alpha),
            payload: params,
        };
    }

    _toLayer(value) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
            const n = Number(value);
            if (Number.isFinite(n)) return n;
        }
        return 0;
    }

    _toBlend(value) {
        switch (value) {
            case 'ALPHA':
            case 'MULTIPLY':
                return value;
            case 'ADD':
            default:
                return 'ADD';
        }
    }

    _toAlpha(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return Math.max(0, Math.min(1, value));
        }
        return 1;
    }

    _isPositionInZone(pos, bbox) {
        return pos[0] >= bbox[0] && pos[0] <= bbox[3]
            && pos[1] >= bbox[1] && pos[1] <= bbox[4]
            && pos[2] >= bbox[2] && pos[2] <= bbox[5];
    }

    _computeSpatialFactor(fixture, fixtureWorldPos, intentPos, range) {
        if (!intentPos || range <= 0) return 1;
        const distance = Vector3.fromTo(fixtureWorldPos, intentPos).magnitude();
        const normalized = Math.max(0, 1 - distance / range);
        const curveName = fixture?.params?.rangeFunction ?? fixture?.params?.rangeFn;
        return FnCurve.evaluate(curveName, normalized);
    }

    _sampleSpatialStrobe(context, intentsByLayer) {
        const layers = [...intentsByLayer.entries()]
            .filter(([, intent]) => intent.intentType === 'light')
            .sort(([a], [b]) => a - b);
        let result = 0;
        for (const [, intent] of layers) {
            const value = intent.payload?.strobe;
            if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) continue;
            const spatialFactor = this._computeSpatialFactor(
                context.fixture,
                context.fixtureWorldPos,
                intent.position,
                context.fixture.range
            );
            result = Math.min(1, result + value * spatialFactor * (intent.alpha ?? 1));
        }
        return result;
    }

    _sampleTopLayerNumber(intentsByLayer, intentType, fieldName) {
        const layers = [...intentsByLayer.entries()]
            .filter(([, intent]) => intent.intentType === intentType)
            .sort(([a], [b]) => b - a);
        for (const [, intent] of layers) {
            const value = intent.payload?.[fieldName];
            if (typeof value === 'number' && Number.isFinite(value)) return value;
        }
        return undefined;
    }

    _sampleTopLayerBoolean(intentsByLayer, intentType, fieldName) {
        const layers = [...intentsByLayer.entries()]
            .filter(([, intent]) => intent.intentType === intentType)
            .sort(([a], [b]) => b - a);
        for (const [, intent] of layers) {
            const value = intent.payload?.[fieldName];
            if (typeof value === 'boolean') return value;
        }
        return undefined;
    }

    _sampleTopLayerAux(intentsByLayer, intentType) {
        const layers = [...intentsByLayer.entries()]
            .filter(([, intent]) => intent.intentType === intentType)
            .sort(([a], [b]) => b - a);
        const result = {};
        for (const [, intent] of layers) {
            const aux = intent.payload?.aux;
            if (aux === null || typeof aux !== 'object' || Array.isArray(aux)) continue;
            for (const [key, value] of Object.entries(aux)) {
                if (!(key in result) && typeof value === 'number' && Number.isFinite(value)) {
                    result[key] = value;
                }
            }
        }
        return result;
    }
}

