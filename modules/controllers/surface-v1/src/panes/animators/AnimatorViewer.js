import { getCapabilities } from '../../core/systemCapabilities.js'

export class AnimatorViewer {
  /** @returns {string} animation class name as registered in systemCapabilities */
  getClassName () { throw new Error(`${this.constructor.name} must implement getClassName()`) }

  /** @returns {string} human-readable display name */
  getName () { throw new Error(`${this.constructor.name} must implement getName()`) }

  /**
   * Reads the field descriptor for a dotKey from the hub-provided
   * `systemCapabilities.animations[class].descriptor` map.
   * dotKey uses the full `content.*` form; the `content.` prefix is stripped before lookup.
   * Subclasses may override to augment or replace specific entries.
   * @param {string} dotKey
   * @returns {{ name: string, hint?: string, type?: string, range?: [number, number], step?: number, options?: string[], optionsRef?: string, stepFunction?: string } | null}
   */
  getFieldDescriptor (dotKey) {
    const caps = getCapabilities()
    if (!caps) return null
    const anims = caps.animations
    if (!Array.isArray(anims)) return null
    const entry = anims.find(e => e && e.class === this.getClassName())
    const descriptor = entry?.descriptor
    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) return null
    const key = dotKey.startsWith('content.') ? dotKey.slice(8) : dotKey
    const field = /** @type {Record<string, unknown>} */ (descriptor)[key]
    if (!field || typeof field !== 'object' || Array.isArray(field)) return null
    return /** @type {any} */ (field)
  }

  /**
   * Optional custom widget for a dotKey field.
   * Return null to let the framework render a generic widget using getFieldDescriptor.
   * @param {string} _dotKey
   * @param {unknown} _value
   * @param {(value: unknown) => void} _onChange
   * @returns {HTMLElement | null}
   */
  renderField (_dotKey, _value, _onChange) { return null }

  /**
   * Whether switching away from this class should show a data-loss warning.
   * @param {Record<string, unknown>} _record full animation record
   * @returns {boolean}
   */
  shouldWarnOnClassSwitch (_record) { return false }
}
