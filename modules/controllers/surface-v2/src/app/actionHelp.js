import { HelpManager } from '../core/help/HelpManager.js'

/**
 * Fire contextual help for a non-DOM action (canvas gesture, drag-end) that has
 * no element to carry a `data-help` attribute. Quiet: an unauthored key does
 * nothing. Buttons should use `data-help` instead (see attachDataHelp.js).
 * @param {string} key
 */
export function showHelp (key) {
  void HelpManager.show(key, { quiet: true, passThrough: true })
}
