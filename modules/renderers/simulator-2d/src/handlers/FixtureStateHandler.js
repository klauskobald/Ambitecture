/**
 * Consumes the hub's resolved per-fixture `fixtureState` stream into the shared `capsByFixture` map.
 * Fixture output (color/strobe/master/target) is composed from these caps in `EventsHandler`'s draw-time
 * reapply; this handler just stores the latest caps and wakes the render loop.
 */
class FixtureStateHandler {
  constructor (capsByFixture, renderer) {
    this._caps = capsByFixture
    this._renderer = renderer
  }

  handle (message) {
    const entries = message.payload
    if (!Array.isArray(entries)) return
    for (const e of entries) {
      if (e && typeof e.fixtureGuid === 'string' && e.caps && typeof e.caps === 'object') {
        this._caps.set(e.fixtureGuid, e.caps)
      }
    }
    this._renderer.markRenderActivity()
  }
}
