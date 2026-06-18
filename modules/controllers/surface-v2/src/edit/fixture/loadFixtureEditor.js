import { FixtureEditDefault } from './FixtureEditDefault.js'
import { FIXTURE_EDITOR_LOADERS } from './fixtureEditors/registry.js'

/**
 * Resolve the editor instance for a fixture profile `class`: a registered per-class subclass when
 * one exists, otherwise the generic {@link FixtureEditDefault}.
 * @param {string} fixtureClass
 * @returns {Promise<FixtureEditDefault>}
 */
export async function loadFixtureEditor (fixtureClass) {
  const loader = FIXTURE_EDITOR_LOADERS[fixtureClass]
  if (loader) {
    try {
      const mod = await loader()
      if (typeof mod.default === 'function') return new mod.default()
    } catch (err) {
      console.warn(`[fixture-editor] failed to load editor for "${fixtureClass}"`, err)
    }
  }
  return new FixtureEditDefault()
}
