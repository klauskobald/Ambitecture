class LayerIntentEngine {
  constructor () {
    this._intentsByLayer = new Map()
    this._resolvers = new Map()

    this.registerResolver('light.color.xyY', (context, intentsByLayer) => {
      const layers = [...intentsByLayer.entries()]
        .filter(([, intent]) => intent.intentType === 'light')
        .sort(([, a], [, b]) => a.layer - b.layer)

      let mixed = Color.black()
      for (const [, intent] of layers) {
        const colorData = intent.payload?.color
        if (!colorData) continue
        if (
          typeof colorData.x !== 'number' ||
          typeof colorData.y !== 'number' ||
          typeof colorData.Y !== 'number'
        ) {
          continue
        }

        const spatialFactor = this._computeSpatialFactor(
          context.fixture,
          context.fixtureWorldPos,
          intent.position,
          context.fixture.range,
          intent.radius,
          intent.radiusFunction
        )
        const layerColor = new Color(
          colorData.x,
          colorData.y,
          Math.max(0, Math.min(1, colorData.Y * spatialFactor))
        )
        mixed = mixed.blend(
          layerColor,
          intent.blend || 'ADD',
          intent.alpha ?? 1
        )
      }
      return mixed
    })

    this.registerResolver('light.strobe', (context, intentsByLayer) =>
      this._sampleSpatialAdditive(context, intentsByLayer, 'light', 'strobe')
    )
    this.registerResolver('light.brightness', (context, intentsByLayer) =>
      this._sampleSpatialAdditive(
        context,
        intentsByLayer,
        'light',
        'brightness'
      )
    )
    this.registerResolver('light.aux', (_context, intentsByLayer) =>
      this._sampleTopLayerAux(intentsByLayer, 'light')
    )
    this.registerResolver('master.brightness', (_context, intentsByLayer) =>
      this._sampleTopLayerNumber(intentsByLayer, 'master', 'brightness')
    )
    this.registerResolver('master.blackout', (_context, intentsByLayer) =>
      this._sampleTopLayerBoolean(intentsByLayer, 'master', 'blackout')
    )
  }

  registerResolver (capabilityKey, resolverFn) {
    this._resolvers.set(capabilityKey, resolverFn)
  }

  applyEvent (event, zones) {
    if (!Array.isArray(zones) || zones.length === 0) return false
    if (!event.guid) return false
    const eventPos = event.position
    const intent = this._toIntentRecord(event)
    if (eventPos) {
      const matchedZone = zones.find(zone =>
        this._isPositionInZone(eventPos, zone.bbox)
      )
      if (!matchedZone) return this._intentsByLayer.delete(event.guid)
      intent.zoneName = matchedZone.name
    }
    this._intentsByLayer.set(event.guid, intent)
    return true
  }

  clear () {
    this._intentsByLayer.clear()
  }

  getActiveIntents () {
    return this._intentsByLayer
  }

  sample (context, capabilityKey) {
    const resolver = this._resolvers.get(capabilityKey)
    if (!resolver) return undefined
    const scopedIntentsByLayer = new Map(
      [...this._intentsByLayer.entries()].filter(
        ([, intent]) =>
          intent.zoneName === undefined || intent.zoneName === context.zoneName
      )
    )
    return resolver(context, scopedIntentsByLayer)
  }

  _toIntentRecord (event) {
    const params =
      event.params && typeof event.params === 'object' ? event.params : {}
    return {
      guid: event.guid,
      layer: this._toLayer(event.layer),
      name: typeof event.name === 'string' ? event.name : '',
      intentType: event.class,
      position: event.position,
      radius:
        typeof event.radius === 'number' && Number.isFinite(event.radius)
          ? event.radius
          : undefined,
      radiusFunction:
        typeof event.radiusFunction === 'string' &&
        event.radiusFunction.trim() !== ''
          ? event.radiusFunction
          : undefined,
      blend: this._toBlend(params.blend),
      alpha: this._toAlpha(params.alpha),
      payload: params
    }
  }

  _toLayer (value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const n = Number(value)
      if (Number.isFinite(n)) return n
    }
    return 0
  }

  _toBlend (value) {
    switch (value) {
      case 'ALPHA':
      case 'MULTIPLY':
        return value
      case 'ADD':
      default:
        return 'ADD'
    }
  }

  _toAlpha (value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.min(1, value))
    }
    return 1
  }

  _isPositionInZone (pos, bbox) {
    return (
      pos[0] >= bbox[0] &&
      pos[0] <= bbox[3] &&
      pos[1] >= bbox[1] &&
      pos[1] <= bbox[4] &&
      pos[2] >= bbox[2] &&
      pos[2] <= bbox[5]
    )
  }

  _computeSpatialFactor (
    fixture,
    fixtureWorldPos,
    intentPos,
    range,
    intentRadius,
    intentRadiusFunction
  ) {
    if (!intentPos || range <= 0) return 1
    const distance = Vector3.fromTo(fixtureWorldPos, intentPos).magnitude()
    const fixtureNormalized = Math.max(0, 1 - distance / range)
    const fixtureCurveName =
      fixture?.params?.rangeFunction ?? fixture?.params?.rangeFn
    const fixtureFactor = FnCurve.evaluate(fixtureCurveName, fixtureNormalized)
    if (intentRadius === undefined || intentRadius <= 0) {
      return fixtureFactor
    }
    const intentNormalized = Math.max(0, 1 - distance / intentRadius)
    const intentFactor = FnCurve.evaluate(
      intentRadiusFunction,
      intentNormalized
    )
    return fixtureFactor * intentFactor
  }

  // Accumulates from 0. Zero-state = 0. Use for additive effects (strobe).
  _sampleSpatialAdditive (context, intentsByLayer, intentType, paramKey) {
    const layers = this._layersSorted(intentsByLayer, intentType)
    let result = 0
    for (const intent of layers) {
      const value = intent.payload?.[paramKey]
      if (typeof value !== 'number' || !Number.isFinite(value) || value === 0)
        continue
      const f = this._computeSpatialFactor(
        context.fixture,
        context.fixtureWorldPos,
        intent.position,
        context.fixture.range,
        intent.radius,
        intent.radiusFunction
      )
      result = Math.min(1, result + value * f * (intent.alpha ?? 1))
    }
    return result
  }

  // Reduces from 1. Zero-state = 1. Use for modulative effects (brightness).
  // Outside an intent's radius spatialFactor → 0, so reduction → 0 and result stays 1.
  _sampleSpatialSubtractive (context, intentsByLayer, intentType, paramKey) {
    const layers = this._layersSorted(intentsByLayer, intentType)
    let reduction = 0
    for (const intent of layers) {
      const value = intent.payload?.[paramKey]
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      const f = this._computeSpatialFactor(
        context.fixture,
        context.fixtureWorldPos,
        intent.position,
        context.fixture.range,
        intent.radius,
        intent.radiusFunction
      )
      reduction = Math.min(1, reduction + (1 - value) * f * (intent.alpha ?? 1))
    }
    return Math.max(0, 1 - reduction)
  }

  _layersSorted (intentsByLayer, intentType) {
    return [...intentsByLayer.values()]
      .filter(intent => intent.intentType === intentType)
      .sort((a, b) => a.layer - b.layer)
  }

  _sampleTopLayerNumber (intentsByLayer, intentType, fieldName) {
    const layers = [...intentsByLayer.entries()]
      .filter(([, intent]) => intent.intentType === intentType)
      .sort(([, a], [, b]) => b.layer - a.layer)
    for (const [, intent] of layers) {
      const value = intent.payload?.[fieldName]
      if (typeof value === 'number' && Number.isFinite(value)) return value
    }
    return undefined
  }

  _sampleTopLayerBoolean (intentsByLayer, intentType, fieldName) {
    const layers = [...intentsByLayer.entries()]
      .filter(([, intent]) => intent.intentType === intentType)
      .sort(([, a], [, b]) => b.layer - a.layer)
    for (const [, intent] of layers) {
      const value = intent.payload?.[fieldName]
      if (typeof value === 'boolean') return value
    }
    return undefined
  }

  _sampleTopLayerAux (intentsByLayer, intentType) {
    const layers = [...intentsByLayer.entries()]
      .filter(([, intent]) => intent.intentType === intentType)
      .sort(([, a], [, b]) => b.layer - a.layer)
    const result = {}
    for (const [, intent] of layers) {
      const aux = intent.payload?.aux
      if (aux === null || typeof aux !== 'object' || Array.isArray(aux))
        continue
      for (const [key, value] of Object.entries(aux)) {
        if (
          !(key in result) &&
          typeof value === 'number' &&
          Number.isFinite(value)
        ) {
          result[key] = value
        }
      }
    }
    return result
  }
}
