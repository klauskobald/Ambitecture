/**
 * `light.color.xyY` arrives from the hub as `[x,y,Y]`; rewrap into a Color so fixture classes
 * (which call `color.toRGB()`) are unchanged. Other caps pass through.
 */
function sampleFixtureCap (caps, key) {
  const v = caps[key]
  if (v === undefined) return undefined
  if (key === 'light.color.xyY' && Array.isArray(v) && v.length === 3) {
    return new Color(v[0], v[1], v[2])
  }
  return v
}

class EventsHandler {
  constructor (configHandler, renderer, capsByFixture) {
    this.configHandler = configHandler
    this._renderer = renderer
    this._caps = capsByFixture
    // The engine is kept only as the intent store for drawing markers (EventLight/EventMaster/target);
    // fixture OUTPUT is resolved on the hub and read from `capsByFixture`.
    this._layerIntentEngine = new LayerIntentEngine()
    this.queue = new EventQueue(
      events => this.processBatch(events),
      () => {
        this._renderer.markRenderActivity()
      }
    )
  }

  handle (message) {
    const events = message.payload
    if (!Array.isArray(events)) return
    this.queue.enqueue(events)
  }

  reapplyCurrentIntents (clearFirst = false) {
    if (clearFirst) this._layerIntentEngine.clear()
    const zones = this.configHandler.getZones()
    if (!Array.isArray(zones) || zones.length === 0) {
      return
    }
    const intentsByLayer = this._layerIntentEngine.getActiveIntents()
    for (const zone of zones) {
      for (const fixture of zone.fixtures) {
        const context = {
          fixture,
          fixtureWorldPos: fixture.location,
          zoneName: zone.name
        }
        const caps = (fixture.guid && this._caps.get(fixture.guid)) || {}
        const snapshot = {
          sample: capabilityKey => sampleFixtureCap(caps, capabilityKey)
        }
        fixture.applyIntentSnapshot(context, snapshot)
      }
    }
    this._renderer.setIntentLayers(intentsByLayer)
  }

  processBatch (events) {
    const zones = this.configHandler.getZones()
    if (!Array.isArray(zones) || zones.length === 0) {
      return
    }
    let anyChanged = false
    for (const event of events) {
      const changed = this._layerIntentEngine.applyEvent(event, zones)
      if (changed) anyChanged = true
    }
    if (!anyChanged) return
    this.reapplyCurrentIntents()
  }
}
