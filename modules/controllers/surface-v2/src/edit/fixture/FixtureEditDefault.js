import { FIXTURE_ROOT_DESCRIPTORS } from './fixtureRootDescriptors.js'

/**
 * Generic, YAML-driven editor behaviour for a fixture instance. The host
 * ({@link module:edit/fixture/FixtureParamsHost}) depends only on this interface; a fixture
 * class that needs to interfere with display or saving ships a subclass under `fixtureEditors/`
 * (registered in `fixtureEditors/registry.js`) and overrides the relevant lifecycle method.
 *
 * @typedef {{ ok: boolean, value?: unknown, message?: string }} FixtureValidateResult
 * @typedef {{ class: string, instance: unknown[] }} FixtureProfileSlice
 */
export class FixtureEditDefault {
  /**
   * Descriptors for the common instance root fields (name, location, range).
   * @returns {Array<Record<string, unknown>>}
   */
  rootDescriptors () {
    return FIXTURE_ROOT_DESCRIPTORS
  }

  /**
   * Descriptors for the fixture-specific instance `params`, taken from the profile YAML
   * `instance` section. Marked mandatory so each authored param is always shown (YAML may
   * override per descriptor).
   * @param {FixtureProfileSlice} profile
   * @returns {Array<Record<string, unknown>>}
   */
  paramDescriptors (profile) {
    const list = Array.isArray(profile?.instance) ? profile.instance : []
    return list.map(d => ({
      isMandatory: true,
      ...(/** @type {Record<string, unknown>} */ (d))
    }))
  }

  /**
   * Validate (and optionally coerce) a value before it is written. Return `{ ok: false }` to
   * reject; return `{ ok: true, value }` to substitute a coerced value.
   * @param {string} _dotKey
   * @param {unknown} _value
   * @param {Record<string, unknown> | null} _record
   * @returns {FixtureValidateResult}
   */
  validate (_dotKey, _value, _record) {
    return { ok: true }
  }

  /**
   * Hook to augment the rendered panel body (extra rows, warnings, …).
   * @param {HTMLElement} _body
   * @param {{ guid: string, profile: FixtureProfileSlice, record: Record<string, unknown> | null }} _ctx
   */
  decorate (_body, _ctx) {}

  /** Hook fired after a batch of edits is flushed to the hub. */
  onSaved () {}
}
